# aws-vpc-flow-log-appender

aws-vpc-flow-log-appender is a sample project that enriches AWS [VPC Flow Log](http://docs.aws.amazon.com/AmazonVPC/latest/UserGuide/flow-logs.html) data with additional information, primarily the Security Groups associated with the instances to which requests are flowing.

This project makes use of several AWS services, including Elasticsearch, Lambda, and Kinesis Firehose.  These **must** be setup and configured in the proper sequence for the sample to work as expected.  Here, we describe deployment of the Lambda components only.  For details on deploying and configuring other services, please see the accompanying [blog post](https://aws.amazon.com/blogs/security/how-to-optimize-and-visualize-your-security-groups/).

The following diagram is a representation of the AWS services and components involved in this sample:

![VPC Flow Log Appender Services](vpc-flow-log-appender.png)

**NOTE:** This project makes use of a free geolocation service ([http://ipstack.com/](http://ipstack.com/) that enforces a montly limit of 10,000 requests.  It is not *intended for use in a production environment*. We recommend using one of ipstack's paid plans or another commercial source of IP geolocation data if you wish to run this code in such an environment.

## Getting Started

To get started, clone this repository locally:

```
$ git clone https://github.com/awslabs/aws-vpc-flow-log-appender
```

The repository contains [CloudFormation](https://aws.amazon.com/cloudformation/) templates and source code to deploy and run the sample application.

### Prerequisites

To run the vpc-flow-log-appender sample, you will need to:

1. Select an AWS Region into which you will deploy services. Be sure that all required services (AWS Lambda, Amazon Elastisearch Service, AWS CloudWatch, and AWS Kinesis Firehose) are available in the Region you select.
2. Confirm your [installation of the latest AWS CLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html) and that [it is properly configured](http://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html#cli-quick-configuration) with credentials that have appropriate access to your account.
3. [Install aws-sam-cli](https://github.com/awslabs/aws-sam-cli).
4. [Install Node.js and NPM](https://docs.npmjs.com/getting-started/installing-node).

## Configure Geolocation

If you would like to geolocate the source IP address of traffic in your VPC flow logs, you can configure a free account at ipstack.com. Note that the free tier of this service is *not* intended for production use.

To sign-up for a free account at ipstack.com, visit https://ipstack.com/signup/free to obtain an API key.

Once you have obtained your API key, store it in EC2 Systems Manager Parameter Store as follows (replace MY_API_KEY with your own):

``` bash
$ aws ssm put-parameter \
      --name ipstack-api-key \
      --value MY_API_KEY \
      --type SecureString
```

## Preparing to Deploy Lambda

Before deploying the sample, install several dependencies using NPM:

``` bash
$ cd decorator && npm install
$ cd ../ingestor && npm install && cd ..
```

## Deploy Lambda Functions

The deployment of our AWS resources is managed by the [AWS SAM CLI](https://github.com/awslabs/aws-sam-cli) using the [AWS Serverless Application Model](https://github.com/awslabs/serverless-application-model) (SAM).

1. Create a new S3 bucket from which to deploy our source code (ensure that the bucket is created in the same AWS Region as your network and services will be deployed):

    ``` bash
    $ aws s3 mb s3://<MY_BUCKET_NAME>
    ```

2. Using the Serverless Application Model, package your source code and serverless stack:

    ``` bash
    $ sam package --template-file template.yaml \
                  --s3-bucket <MY_BUCKET_NAME> \
                  --output-template-file packaged.yaml
    ```

3. Once packaging is complete, deploy the stack:

    ``` bash
    $ sam deploy --template-file packaged.yaml \
                 --stack-name vpc-flow-log-appender \
                 --capabilities CAPABILITY_IAM
    ```

    Or to deploy with the geolocation feature turned on:

    ``` bash
    $ sam deploy --template-file packaged.yaml \
                 --stack-name vpc-flow-log-appender \
                 --capabilities CAPABILITY_IAM \
                 --parameter-overrides GeolocationEnabled=true
    ```

 4. Once we have deployed our Lambda functions, configure CloudWatch logs to stream VPC Flow Logs to Elasticsearch as described [here](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_ES_Stream.html).

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
    $ aws ec2 describe-instances \
              --query 'Reservations[0].Instances[0].NetworkInterfaces[0].NetworkInterfaceId'
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

* Aug 2 2018 - Updated decorator function and geocode modue to use ipstacks as previous service is now defunct. Amended README to include new instructions on using ipstacks.
* Jun 9 2017 - Fixed issue in which decorator did not return all records to Firehose when geocoder was over 15,000 per hour limit. Instead, will return blank geo data. Added Test methodology.

## Authors

* **Josh Kahn** - *Initial work*
