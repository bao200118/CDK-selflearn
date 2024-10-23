import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { S3Stack } from './s3-stack';
import { EC2Stack } from './ec2-stack';
import {
  AmazonLinuxGeneration,
  AmazonLinuxImage,
  InstanceClass,
  InstanceSize,
  InstanceType,
} from 'aws-cdk-lib/aws-ec2';
import { AlbStack } from './alb-stack';
import { ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { RDSStack } from './Services/DB/rds-stack';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import { AsgCapacityProvider } from 'aws-cdk-lib/aws-ecs';

export class ECSStack{
  public readonly cluster: ecs.Cluster;

  private readonly ECS_RESOURCE_NAME = {
    api: {
      service: {
        id: 'cdk-api-service',
      },
      taskDefinition: {
        id: 'cdk-api-task-definition',
        container: {
          id: 'cdk-api-container',
          image: 'cdk-api-image',
          port: 3000,
          protocol: ApplicationProtocol.HTTP,
          log: 'cdk-api-log-group',
        },
      },
      targetGroup: {
        id: 'cdk-api-target-group',
        healthcheckPath: '/api/health',
        pathPatterns: '/api/*',
        priority: 1,
      },
    },
    admin: {
      service: {
        id: 'cdk-admin-service',
      },
      taskDefinition: {
        id: 'cdk-admin-task-definition',
        container: {
          id: 'cdk-admin-container',
          image: 'cdk-admin-image',
          port: 8081,
          protocol: ApplicationProtocol.HTTPS,
          log: 'cdk-admin-log-group',
        },
      },
      targetGroup: {
        id: 'cdk-admin-target-group',
        healthcheckPath: '/admin/health',
        pathPatterns: '/admin/*',
        priority: 2,
      },
    },
    web: {
      service: {
        id: 'cdk-web-service',
      },
      taskDefinition: {
        id: 'cdk-web-task-definition',
        container: {
          id: 'cdk-web-container',
          image: 'cdk-web-image',
          port: 80,
          protocol: ApplicationProtocol.HTTPS,
          log: 'cdk-web-log-group',
        },
      },
      targetGroup: {
        id: 'cdk-web-target-group',
        healthcheckPath: '/health',
        pathPatterns: '/*',
        priority: 3,
      },
    },
  };

  // Ecs service
  protected readonly apiService: ecs.FargateService;
  protected readonly adminService: ecs.FargateService;
  protected readonly webService: ecs.FargateService;
  private readonly ec2: EC2Stack;
  private readonly alb: AlbStack;
  // private readonly ecrApi: EcrStack;
  // private readonly ecrAdmin: EcrStack;
  // private readonly ecrWeb: EcrStack;

  constructor(
    scope: Construct,
    ec2: EC2Stack,
    alb: AlbStack,
    // ecrApi: EcrStack,
    // ecrAdmin: EcrStack,
    // ecrWeb: EcrStack,
    s3: S3Stack,
    rds: RDSStack,
  ) {
    // Create an ECS cluster
    this.ec2 = ec2;
    this.alb = alb;
    // this.ecrApi = ecrApi;
    // this.ecrAdmin = ecrAdmin;
    // this.ecrWeb = ecrWeb;
    this.cluster = new ecs.Cluster(scope, 'cdk-cluster', {
      vpc: this.ec2.vpc,
    });

    const asg = new AutoScalingGroup(scope, 'MyEcsAsg', {
      vpc: this.ec2.vpc,
      instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
      machineImage: new AmazonLinuxImage({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2
      }),
      spotPrice: "0.007",
      minCapacity: 0,
      maxCapacity: 5,
      desiredCapacity: 1,
    })

    const capacityProvider = new AsgCapacityProvider(scope, 'AsgCapacityProvider', {
      autoScalingGroup: asg,
    });

    this.cluster.addAsgCapacityProvider(capacityProvider)

    this.apiService = this.initEcsService(scope, 'api', "001280989619.dkr.ecr.us-east-1.amazonaws.com/cdk_repository:api", {
      API_URL: 'prtg.cloudhosting.click/api'
    });
    // this.adminService = this.initEcsService(scope, 'admin', this.ecrAdmin.repository, {
    //   BUCKET_NAME: s3.bucket.bucketName,
    // });
    const secretValue = rds.rdsInstance.secret?.secretValue.toJSON()
    this.apiService = this.initEcsService(scope, 'web', "001280989619.dkr.ecr.us-east-1.amazonaws.com/cdk_repository:web", {
      DATABASE_HOST: rds.rdsInstance.dbInstanceEndpointAddress,
      DATABASE_USER: secretValue.username,
      DATABASE_PASSWORD: secretValue.password,
    });
  }

  /**
   * Init resource for ecs service running
   * @param scope stack scope
   * @param resource ecs resource initial
   * @param containerEnv ecs container env
   */
  private initEcsService(
    scope: Construct,
    resource: 'api' | 'web' | 'admin',
    ecrRepo: string,
    containerEnv?: Record<string, string>
  ) {
    // Define Fargate task definition
    const taskDefinition = new ecs.Ec2TaskDefinition(
      scope,
      this.ECS_RESOURCE_NAME[resource].taskDefinition.id,
    );
    // Add container to task definition
    const container = taskDefinition.addContainer(
      this.ECS_RESOURCE_NAME[resource].taskDefinition.container.id,
      {
        image: ecs.ContainerImage.fromRegistry(ecrRepo),
        logging: new ecs.AwsLogDriver({
          streamPrefix: this.ECS_RESOURCE_NAME[resource].taskDefinition.container.log,
        }),
        memoryLimitMiB: 500,
        cpu: 1,
        environment: containerEnv,
      }
    );
    // taskDefinition.addToExecutionRolePolicy(s3.bucketPolicy);

    // Update port mapping foreach service (api, admin, web)
    container.addPortMappings({
      // Container port is also host port with fargate service
      containerPort: this.ECS_RESOURCE_NAME[resource].taskDefinition.container.port,
      protocol: ecs.Protocol.TCP,
    });
    // const securityGroup = new ec2.SecurityGroup(scope, 'service-security-group', {
    //   vpc: this.ec2.vpc,
    //   allowAllOutbound: true,
    // });
    // Create Fargate services and attach to the target groups
    const ec2Service = new ecs.Ec2Service(
      scope,
      this.ECS_RESOURCE_NAME[resource].service.id,
      {
        cluster: this.cluster,
        taskDefinition: taskDefinition,
        desiredCount: 2,
        // vpcSubnets: this.ec2.vpc.selectSubnets({
        //   subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        //   onePerAz: true,
        // }),
        // assignPublicIp: true,
        // securityGroups: [securityGroup],
      }
    );
    const targetGroup = this.alb.createTargetGroup(
      this.ECS_RESOURCE_NAME[resource].targetGroup.id,
      this.ECS_RESOURCE_NAME[resource].taskDefinition.container.port,
      this.ECS_RESOURCE_NAME[resource].taskDefinition.container.protocol,
      {
        path: this.ECS_RESOURCE_NAME[resource].targetGroup.healthcheckPath,
      },
      [ec2Service]
    );
    const listenerCondition = this.alb.createListenerConditionPathPatterns([
      this.ECS_RESOURCE_NAME[resource].targetGroup.pathPatterns,
    ]);
    this.alb.addTargetGroup(
      this.ECS_RESOURCE_NAME[resource].targetGroup.id,
      targetGroup,
      this.ECS_RESOURCE_NAME[resource].targetGroup.priority,
      listenerCondition
    );
    return ec2Service;
  }
}
