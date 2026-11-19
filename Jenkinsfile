// LockIn CI/CD: GitHub → Jenkins → Docker → AWS EC2
// Jenkins credentials needed:
//   dockerhub-creds  (Username/Password)  - Docker Hub login
//   ec2-ssh-key      (SSH Username with private key) - EC2 login
// and set DOCKERHUB_USER + EC2_HOST below (or as Jenkins env vars).
pipeline {
  agent any

  environment {
    DOCKERHUB_USER = 'your-dockerhub-username'
    IMAGE          = "${DOCKERHUB_USER}/lockin"
    TAG            = "${env.BUILD_NUMBER}"
    EC2_HOST       = 'ec2-user@your-ec2-public-ip'
  }

  stages {
    stage('Checkout') {
      steps { checkout scm }
    }

    stage('Install & Test') {
      agent { docker { image 'node:22-alpine'; reuseNode true } }
      steps {
        sh 'npm ci'
        sh 'npm test'
      }
    }

    stage('Build image') {
      steps {
        sh 'docker build -t $IMAGE:$TAG -t $IMAGE:latest .'
      }
    }

    stage('Push image') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'dockerhub-creds', usernameVariable: 'U', passwordVariable: 'P')]) {
          sh 'echo "$P" | docker login -u "$U" --password-stdin'
          sh 'docker push $IMAGE:$TAG && docker push $IMAGE:latest'
        }
      }
    }

    stage('Deploy to AWS EC2') {
      when { branch 'main' }
      steps {
        sshagent(credentials: ['ec2-ssh-key']) {
          // On the EC2 box: ~/lockin contains docker-compose.yml + .env (with API key + secrets)
          sh '''
            ssh -o StrictHostKeyChecking=no $EC2_HOST "
              cd ~/lockin &&
              docker pull $IMAGE:latest &&
              docker compose up -d --no-build &&
              docker image prune -f
            "
          '''
        }
      }
    }
  }

  post {
    success { echo '🔒 LockIn deployed. Locked in.' }
    failure { echo '💀 Pipeline failed - check the stage logs.' }
  }
}
