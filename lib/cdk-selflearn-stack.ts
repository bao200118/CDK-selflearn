import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as awsCodepipeline from 'aws-cdk-lib/aws-codepipeline'
import * as codepipelineActions from 'aws-cdk-lib/aws-codepipeline-actions'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class CdkSelflearnStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const artifactBucket = new s3.Bucket(this, 'Cdk-BucketArtifact', {
      bucketName: 'cdk-bucket-artifact',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })

    const codepipeline = new awsCodepipeline.Pipeline(this, `Cdk-Codepipeline`, {
      pipelineName: 'cdk-codepipeline',
      artifactBucket: artifactBucket,
    });

    codepipeline.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'codebuild:BatchGetBuilds',
          'codebuild:StartBuild',
          'iam:PassRole',
          'iam:CreateRole',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          's3:*',
          'lambda:*',
          'codestar-connections:*',
        ],
        resources: ['*'],
      })
    );

    const inputCodebuild = new awsCodepipeline.Artifact()
    const githubSource = new codepipelineActions.CodeStarConnectionsSourceAction({
      actionName: `Cdk-GithubConnectionSourceAction`,
      owner: process.env.AWS_GITHUB_OWNER || '',
      repo: 'CDK-selflearn',
      branch: 'master',
      output: inputCodebuild,
      connectionArn: process.env.AWS_GITHUB_CONNECTION_ARN || '',
    });

    codepipeline.addStage({
      stageName: 'Source',
      actions: [githubSource],
    });

    const codebuildRole = new iam.Role(this, `Cdk-CodebuildRole`, {
      roleName: `Cdk-CodebuildRole`,
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });

    codebuildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'lambda:*',
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          's3:GetObject',
          's3:PutObject',
          'cloudformation:*',
        ],
        resources: ['*'],
      })
    );

    codebuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:*'],
        resources: ['arn:aws:iam::*:role/lambda-execution-role*'],
      })
    );

    const policyCdk = new iam.Policy(this, 'Cdk-Policy-Cdk', {
      statements: [
        new iam.PolicyStatement({
          sid: "StsAccess",
          effect: iam.Effect.ALLOW,
          actions: [
            "sts:AssumeRole",
            "iam:*Role*"
          ],
          resources: [
            `arn:aws:iam::${process.env.AWS_ACCOUNT_ID}:role/cdk-*`
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "cloudformation:*"
          ],
          resources: [
            `arn:aws:cloudformation:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:stack/CDKToolkit/*`
          ],
        }),
        new iam.PolicyStatement({
          sid: "S3Access",
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:*"
          ],
          resources: [
            "*"
          ]
        }),
        new iam.PolicyStatement({
          sid: "ECRAccess",
          effect: iam.Effect.ALLOW,
          actions: [
            "ecr:SetRepositoryPolicy",
            "ecr:GetLifecyclePolicy",
            "ecr:PutImageScanningConfiguration",
            "ecr:DescribeRepositories",
            "ecr:CreateRepository",
            "ecr:DeleteRepository",
            "ecr:PutLifecyclePolicy"
          ],
          resources: [
            `arn:aws:ecr:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:repository/cdk-*`
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ssm:GetParameter*",
            "ssm:PutParameter*",
            "ssm:DeleteParameter*"
          ],
          resources: [
            `arn:aws:ssm:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:parameter/cdk-bootstrap/*`],
        })
      ]
    })

    policyCdk.attachToRole(codebuildRole)
    const outputChangeSets = new awsCodepipeline.Artifact()
    codepipeline.addStage({
      stageName: 'ChangeSet',
      actions: [
        new codepipelineActions.CodeBuildAction({
          actionName: `Cdk-CodebuildAction-ChangeSets`,
          project: this.createCodebuildProject('ChangeSets', 'changesets-spec.yml', codebuildRole),
          input: inputCodebuild,
          // Output zip file node_modules, so that deploy stage no need to install again
          outputs: [outputChangeSets],
        }),
      ],
    });
    codepipeline.addStage({
      stageName: 'ManualApprove',
      actions: [
        new codepipelineActions.ManualApprovalAction({
          actionName: 'Cdk-Manual-Approve'
        })
      ]
    })
    codepipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new codepipelineActions.CodeBuildAction({
          actionName: `Cdk-CodebuildAction-Deploy`,
          project: this.createCodebuildProject('Deploy', 'deploy-spec.yml', codebuildRole),
          input: outputChangeSets,
        }),
      ]
    })
  }

  // Get all variable in file env
  private createCodebuildProject(stage: string, buildSpecFile: string, codebuildRole: iam.Role) {
    return new codebuild.PipelineProject(
      this,
      `Cdk-CodebuildProject-${stage}`,
      {
        projectName: `Cdk-CodebuildProject-${stage}`,
        role: codebuildRole,
        buildSpec: codebuild.BuildSpec.fromSourceFilename(buildSpecFile),
        environment: {
          computeType: codebuild.ComputeType.SMALL,
        },
        environmentVariables: {
          VARIABLE: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: 'test-variable'
          }
        },
        logging: {
          cloudWatch: {
            logGroup: new logs.LogGroup(
              this,
              `Cdk-LogGroup-Codebuild-${stage}`,
              {
                logGroupName: `Cdk-LogGroup-Codebuild-${stage}`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                retention: logs.RetentionDays.THREE_MONTHS,
              }
            ),
            enabled: true,
            prefix: 'Cdk',
          },
        },
      }
    )
  }
}
