QuikHit MVP
QuikHit is an innovative advertising platform designed specifically for live-streaming environments. It provides real-time, AI-driven ad delivery solutions for Twitch, YouTube, and other platforms, enabling streamers to seamlessly monetize their streams, while advertisers gain unparalleled targeting capabilities.

## Contents
- Project Overview
- Architecture and System Design
- Setup and Installation
- Deployment
- Testing
- API Reference
- User Guide
- Developer Guidelines
- Security and Compliance
- Future Roadmap

## 1. Project Overview

### Scope and Vision
QuikHit provides a unique way for streamers to offer quick-hit ad space throughout their live streams for advertisers to purchase. The platform uses advanced AI, real-time auction systems, and blockchain for transparency. Our goal is to redefine live-stream monetization and eventually position QuikHit for acquisition by major tech firms.

### Key Features
- **Quick-Hit Ad Buying:** Quick and easy ad purchases by advertisers directly through the platform, allowing businesses of all sizes to participate in live-stream advertising without complex negotiations or contracts.
- **Real-Time Auctions:** Advertisers can bid in real-time for ad slots during live streams, ensuring competitive pricing.
- **AI-Powered Ad Targeting:** Leverage machine learning models to ensure targeted, effective advertising that maximizes engagement and conversion rates.
- **Blockchain-Based Transparency:** Blockchain is used to track transactions and ensure transparency in ad revenue sharing.
- **Personalized Metrics Dashboard:** A comprehensive dashboard for streamers, advertisers, and admins, powered by real-time data insights.

## 2. Architecture and System Design

### High-Level Architecture
QuikHit follows a microservices architecture:

- **Frontend:** Built in React, utilizing SWR for data fetching and Chart.js for data visualization.
- **Backend:** Node.js with Express handles API requests, real-time auction management, ad delivery, and user authentication.
- **Database:** MongoDB for persistence of user, ad, and transaction data.
- **Job Queue:** Bull queues are used for background processing of auctions, fraud detection, optimization, etc.
- **Third-Party Integrations:** Integrated with Twitch, YouTube APIs, Firebase, and blockchain.

### Component Overview
- **Ad Service:** Manages ad creation, deletion, targeting, and Quick-Hit ad purchases.
- **Auction Service:** Handles auction creation, bidding, and finalization.
- **Fraud Detection Service:** Uses ML models to detect potential fraud.
- **Dashboard Service:** Displays metrics and insights to users.

## 3. Setup and Installation

### Prerequisites
- Node.js (v14+)
- MongoDB (v4+)
- Docker (optional for containerization)
- Redis (for job queues)
- Firebase Account (for notifications)

### Installation Steps
Clone the repository:
```sh
git clone https://github.com/kylemac21188/quikhit-mvp.git
cd quikhit-mvp
```

Install dependencies:
```sh
npm install
```

Configure environment variables: Create a `.env` file in the root directory with the following variables:
```sh
JWT_SECRET=your_secret_key
MONGO_URI=your_mongo_connection_string
REDIS_HOST=127.0.0.1
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
```

Run the server:
```sh
npm start
```

### Running Locally
For local development, you can also use Docker:
```sh
docker-compose up
```
This will spin up MongoDB, Redis, and the QuikHit backend as containers.

## 4. Deployment

### Deployment Architecture
We use a microservices-based architecture, with components running on Kubernetes clusters for horizontal scaling:

- Kubernetes manages containerized versions of the backend, Redis, and MongoDB.
- Prometheus and Grafana are used for monitoring.
- AWS/GCP: Services are deployed using cloud infrastructure.

### Deployment Steps
Build the Docker image:
```sh
docker build -t quikhit-mvp .
```

Push to container registry (e.g., Docker Hub).

Deploy on Kubernetes using the provided manifests (`k8s/` folder).

### CI/CD Pipeline
We use GitHub Actions for continuous integration and delivery. Each pull request is automatically tested and, if successful, deployed to a staging environment.

## 5. Testing

### Test Plan and Strategy
We use a combination of unit, integration, and E2E testing to ensure the reliability of QuikHit:

- **Unit Testing:** Jest is used for all backend services.
- **Integration Testing:** We use Supertest to validate that services interact correctly.
- **End-to-End Testing:** Cypress is used to simulate the full user journey.

### Running Tests
To run all tests:
```sh
npm test
```

For end-to-end tests:
```sh
npx cypress open
```

## 6. API Reference

### Endpoints Overview
The API allows full control over ad creation, bidding, ad buying, and data retrieval:

#### Ads
- `POST /ads/create`: Create a new ad.
- `POST /ads/auction`: Bid on an active auction.
- `POST /ads/quick-buy`: Purchase a quick-hit ad slot immediately.
- `GET /ads/metrics`: Fetch metrics related to ads.

#### Users
- `POST /users/signup`: Register a new user.
- `POST /users/login`: Authenticate and get a token.

### Interactive API Documentation
Access our Swagger-based API playground for detailed API testing: [Swagger Playground Link]

## 7. User Guide

### Getting Started
- Register as a user (streamer, advertiser, or admin).
- Advertisers can create ads, participate in auctions, and purchase ad slots instantly through the Quick-Hit Ad Buying feature.
- Streamers can approve ads for their stream and view earnings.

### Dashboard Walkthrough
The Dashboard provides:
- **Personalized Insights:** AI-powered insights on viewer engagement.
- **Metrics:** Real-time updates on ad performance.

### Troubleshooting
- **Unable to Bid?** Ensure you are logged in and have sufficient credits.
- **No Ad Insights?** Check the network connection and try refreshing the page.

## 8. Developer Guidelines

### Coding Standards
- **JavaScript Standards:** Use ESLint and Prettier.
- **Naming Conventions:** Follow camelCase for variables and PascalCase for components.

### Contribution Guidelines
- **Branching Strategy:** Use feature branches, submit pull requests, and await code review.
- **Pull Request Requirements:** Ensure that all tests pass and that the code adheres to linting rules.

### Extending Functionality
To extend QuikHit with new features:
1. Create a feature branch.
2. Implement the changes.
3. Write unit and integration tests for the new functionality.
4. Open a pull request.

## 9. Security and Compliance

### Authentication and Authorization
- OAuth2 for third-party login support (Twitch, Google).
- JWT for securing API endpoints.

### GDPR Compliance
- **Opt-Out Process:** Users can delete their data via the `/users/delete` endpoint.
- **Data Encryption:** Sensitive information is encrypted at rest using AES-256.

### Blockchain Transparency
All ad revenue transactions are logged on a blockchain to ensure transparency and prevent fraud.

## 10. Future Roadmap

### Planned Features
- **AR/VR Integration:** Introducing AR/VR ads to enhance the experience.
- **Advanced Fraud Detection:** Improved fraud detection using graph-based ML models.
- **Mobile App:** A mobile version for managing ads and metrics on-the-go.

### Scalability Enhancements
- **Multi-Region Deployments:** Expand infrastructure to serve users across different geographic regions.

## Glossary
- **Quick-Hit Ad Buying:** A feature that allows advertisers to immediately purchase ad slots without going through an auction.
- **Ad Slot:** A predefined slot in a live stream that can be filled with ads.
- **Auction:** A bidding event where advertisers compete for an ad slot.
- **RBAC:** Role-Based Access Control for secure resource management.

## License
This project is licensed under the MIT License.

## Contact
For questions, feel free to reach out to kyle.mac21188@gmail.com.
