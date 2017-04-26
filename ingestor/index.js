/**
 
Copyright 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file
except in compliance with the License. A copy of the License is located at

    http://aws.amazon.com/apache2.0/
 
or in the "license" file accompanying this file. This file is distributed on an "AS IS"
BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under the License.

 */

'use strict'

/**
 * This function ingests VPC Flow Logs from the producer and passes them to
 * a Kinesis Firehose that will decorate the data and push it to Elasticsearch.
 * 
 * After creating the VPC Flow Logs CloudWatch Log Group, you will need to
 * configure deliveru of the logs to this function via CloudWatch. Note that
 * the function must be deployed first to Lambda.
 * 
 * Adapted from
 * https://github.com/bsnively/aws-big-data-blog/blob/master/aws-blog-vpcflowlogs-athena-quicksight/CloudwatchLogsToFirehose/lambdacode.py
 * 
 * 
 *   VPC --> CloudWatch  --> Lambda#ingestor --> Kinesis --> Elasticsearch
 *           (Flow Logs)                         Firehose
 *                                                  +
 *                                           Lambda#decorator
 * 
 */

const AWS  = require('aws-sdk');
const zlib = require('zlib');

/**
 * Put records in Kinesis Firehose to be decorated and sent to Elasticsearch.
 * 
 * @param records  - JSON records to be pushed to Firehose
 */
const putRecords = (records) => {  
  var params = {
    DeliveryStreamName: process.env.DELIVERY_STREAM_NAME,
    Records: records
  }

  var firehose = new AWS.Firehose();
  firehose.putRecordBatch(params, (error, data) => {
    if (error) {
      console.error('[ERROR - putRecordBatch] ' + error);
    }
    else {
      console.log('[Firehose] putRecordBatch successful')
    }
  })
};

/**
 * Creates records to be consumed in Firehose from VPC Flow Log events.
 * 
 * @param events - VPC Flow Log events
 * @return `Promise` for async processing
 */
const createRecordsFromEvents = (events) => {
  return new Promise( (resolve, reject) => {
      var records = [];

      events.forEach( (event) => {
        if (event.messageType === 'CONTROL_MESSAGE') {
          console.log('Skipping control message');
          return;
        }

        var logEvent = {
          Data: `${event.message}\n`
        }
        records.push(logEvent);

        // catch at 500 records and push to firehose
        if (records.length > 499) {
          this.putRecords(records);
          records = [];
        }
      }, this);

      resolve(records);
  });
}

/**
 * Asynchronously gunzips a buffer, returning a Promise.
 * 
 * @param buffer - buffer to be gunzipped
 * @return `Promise` for async processing
 */
const gunzipPromise = (buffer) => {
  return new Promise( (resolve, reject) => {
    zlib.gunzip(buffer, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  })
}

/**
 * 
 * Main Lambda handler.  VPC Flow Log events will enter the funciton in
 * the following format:
 * 
 * [ 
 *   { Data: '2 <ACCOUNT_ID> eni-4ff3618a 2.178.18.24 10.100.5.78 23458 7547 6 1 40 1490365304 1490365358 ACCEPT OK\n' },
 *   { Data: '2 <ACCOUNT_ID> eni-4ff3618a 190.48.42.140 10.100.5.78 41965 2222 6 1 40 1490365421 1490365478 ACCEPT OK\n' },
 *   { Data: '2 <ACCOUNT_ID> eni-4ff3618a 121.217.240.138 10.100.5.78 52627 7547 6 1 40 1490365421 1490365478 ACCEPT OK\n' }
 * ]
 * 
 */
exports.handler = (event, context) => {
  var zippedData = Buffer.from(event.awslogs.data, 'base64');
  gunzipPromise(zippedData)
    .then( (data) => {
      let logData = JSON.parse(data.toString('utf8'));
      return createRecordsFromEvents(logData.logEvents);
    })
    .then( (records) => {
      if (records.length > 0) {
        putRecords(records);
      }
      context.succeed();
    })
    .catch( (error) => {
      console.error('[ERROR] ' + error);
      context.fail(error);
    })
};