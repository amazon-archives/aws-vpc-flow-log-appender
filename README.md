# aws-vpc-flow-log-appender

aws-vpc-flow-log-appender is a sample project that enriches AWS [VPC Flow Log](http://docs.aws.amazon.com/AmazonVPC/latest/UserGuide/flow-logs.html) data with additional information, primarily the Security Groups associated with the instances to which requests are flowing.

This project makes use of several AWS services, including Elasticsearch, Lambda, and Kinesis Firehose.  These **must** be setup and configured in the proper sequence for the sample to work as expected.  Here, we describe deployment of the Lambda components only.  For details on deploying and configuring other services, please see the accompanying [blog post](https://aws.amazon.com/blogs/security/how-to-visualize-and-refine-your-networks-security-by-adding-security-group-ids-to-your-vpc-flow-logs/).

The following diagram is a representation of the AWS services and components involved in this sample:

![VPC Flow Log Appender Services](vpc-flow-log-appender.png)

**NOTE:** This project makes use of a free geolocation service ([http://freegeoip.net/](http://freegeoip.net/) that enforces an hourly limit of 15,000 requests.  It is not *intended for use in a production environment*. We recommend using a commercial source of IP geolocation data if you wish to run this code in such an environment.

## Getting Started

To get started, clone this repository locally:

```
$ git clone https://github.com/awslabs/aws-vpc-flow-log-appender
```

The repository contains [CloudFormation](https://aws.amazon.com/cloudformation/) templates and source code to deploy and run the sample application.

### Prerequisites

To run the vpc-flow-log-appender sample, you will need to:

1. Select an AWS Region into which you will deploy services. Be sure that all required services (AWS Lambda, Amazon Elastisearch Service, AWS CloudWatch, and AWS Kinesis Firehose) are available in the Region you select.
2. Confirm your [installation of the latest AWS CLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html) (at least version 1.11.21).
3. Confirm the [AWS CLI is properly configured](http://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html#cli-quick-configuration) with credentials that have administrator access to your AWS account.
4. [Install Node.js and NPM](https://docs.npmjs.com/getting-started/installing-node).

## Preparing to Deploy Lambda

Before deploying the sample, install several dependencies using NPM:

```
$ cd vpc-flow-log-appender/decorator
$ npm install
$ cd ../ingestor
$ npm install
$ cd ..
```

## Deploy Lambda Functions

The deployment of our AWS resources is managed by a CloudFormation template using AWS Serverless Application Model.

1. Create a new S3 bucket from which to deploy our source code (ensure that the bucket is created in the same AWS Region as your network and services will be deployed):

    ```
    $ aws s3 mb s3://<MY_BUCKET_NAME>
    ```

2. Using the Serverless Application Model, package your source code and serverless stack:

    ```
    $ aws cloudformation package --template-file app-sam.yaml --s3-bucket <MY_BUCKET_NAME> --output-template-file app-sam-output.yaml
    ```

3. Once packaging is complete, deploy the stack:

    ```
    $ aws cloudformation deploy --template-file app-sam-output.yaml --stack-name vpc-flow-log-appender-dev --capabilities CAPABILITY_IAM
    ```

 4. Once we have deployed our Lambda functions, we need to return to CloudWatch and configure VPC Flow Logs to stream the data to the Lambda function. (TODO: add more detail)

## Testing

In addition to running aws-vpc-flow-log-appender using live VPC Flow Log data from your own environment, we can also leverage the [Kinesis Data Generator](https://awslabs.github.io/amazon-kinesis-data-generator/web/producer.html) to send mock flow log data to our Kinesis Firehose instance.

To get started, review the [Kinesis Data Generator Help](https://awslabs.github.io/amazon-kinesis-data-generator/web/help.html) and use the included CloudFormation template to create necessary resources.

When ready:

1. Navigate to your Kinesis Data Generator and login.

2. Select the Region to which you deployed aws-vpc-flow-log-appender and select the appropriate Stream (e.g. "VPCFlowLogsToElasticSearch"). Set Records per Second to 50.

3. Next, we will use the AWS CLI to retrieve several values specific to your AWS Account to generate feasible VPC Flow Log data:

    ```
    # ACCOUNT_ID
    $ aws sts get-caller-identity --query 'Account'

    # ENI_ID (e.g. "eni-1a2b3c4d")
    $ aws ec2 describe-instances --query 'Reservations[0].Instances[0].NetworkInterfaces[0].NetworkInterfaceId'
    ```

4. Finally, we can build a template for KDG using the following.  Be sure to replace `<<ACOUNT_ID>>` and `<<ENI_ID>>` with the values your captured in step 3 (do not include quotes).

    ```
    2 <<ACCOUNT_ID>> <<ENI_ID>> {{internet.ip}} 10.100.2.48 45928 6379 6 {{random.number(1)}} {{random.number(600)} 1493070293 1493070332 ACCEPT OK
    ```

5. Returning back to KDG, copy and paste the mock VPC Flow Log data in Template 1.  Then click the "Send data" button.

6. Stop KDG after a few seconds by clicking "Stop" in the popup.

7. After a few minutes, check CloudWatch Logs and your Elasticsearch cluster for data.

A few notes on the above test procedure:

* While our example utilizes the ENI ID of an EC2 instance, you may use any ENI available in the AWS Region in which you deployed the sample code.
* Feel free to tweak the mock data template if needed, this is only intended to be an example.
* Do not modify values in double curly braces, these are part of the KDG template and will automatically be filled.

## Cleaning Up

To clean-up the Lambda functions when you are finished with this sample:

```
$ aws cloudformation delete-stack --stack-name vpc-flow-log-appender-dev
```

## Updates

* Jun 9 2017 - Fixed issue in which decorator did not return all records to Firehose when geocoder was over 15,000 per hour limit. Instead, will return blank geo data. Added Test methodology.

## Authors

* **Josh Kahn** - *Initial work*
