# Personal Finance Tracker

Personal Finance Tracker is a full-stack web application that provides a structured and scalable approach to personal financial management. It combines transaction operations, budget governance, savings planning, analytics, anomaly detection, and AI-assisted advisory workflows in a single platform.

The solution is built on Node.js, Express, PostgreSQL, Sequelize, and EJS, with a service-oriented backend structure designed for maintainability and production readiness.

## Table of Contents

- Overview
- Business Capabilities
- Technical Architecture
- Repository Structure
- Environment Configuration
- Local Development
- Deployment
- Security and Data Controls
- Operational Scripts
- Roadmap
- License

## Overview

The application is designed to help users make informed financial decisions through complete visibility of income and expenditure, disciplined budget tracking, and actionable insights generated from both deterministic and AI-driven logic.

Primary outcomes delivered by the platform:
- Consolidated financial records across expenses, income, budgets, and savings.
- Improved spending discipline through alerts, anomaly identification, and historical reporting.
- Faster financial operations with import workflows and automated categorization.
- Personalized recommendations through AI financial conversation support.

## Business Capabilities

### Identity and Access
- Local authentication with password hashing (bcrypt).
- Google OAuth authentication.
- Session-based access control for protected routes.
- OTP-based password reset workflow.

### Transactions
- Full transaction lifecycle: create, update, delete, and view.
- Receipt upload and storage integration.
- Category, date, type, amount, and currency handling.
- User-currency display conversion for operational consistency.

### Budget Governance
- Category-level monthly budget creation and updates.
- Centralized base-currency storage with localized display conversion.
- Event-triggered email notifications for budget updates and threshold activity.

### Savings and Planning
- Savings record management with primary allocation support.
- Monthly savings plan definition and completion tracking.
- Dynamic total-savings view based on converted user currency.

### Reporting and Analytics
- Annual income and expense summaries.
- Category distribution insights for income and expense.
- Six-month trend analytics.
- Month-by-month full-year financial breakdown.

### Spending Risk Intelligence
- Statistical anomaly detection for unusual expense spikes.
- Frequency-cluster detection for repeated same-day patterns.
- Dismiss workflow for reviewed anomalies.

### AI Financial Advisory
- Conversational AI interface for financial guidance.
- Context-enriched prompts using transactions, budgets, and savings.
- Provider flexibility for xAI and Groq-compatible endpoints.

### Statement Import and Reconciliation
- CSV statement import workflow.
- Flexible column interpretation for varied bank export formats.
- Duplicate detection before persistence.
- Auto-categorization based on existing categories and transaction heuristics.
- Human-in-the-loop preview and confirmation before final save.

## Technical Architecture

- Backend runtime: Node.js
- Web framework: Express
- Templating layer: EJS
- ORM: Sequelize
- Database: PostgreSQL
- Authentication framework: Passport (Local + Google OAuth)
- Session management: express-session
- Upload handling: multer
- Email provider integration: Resend
- AI integration: axios-based OpenAI-compatible API calls
- Charting: Chart.js

## Repository Structure

```text
personal-finance-tracker/
  app.js
  config/
    db.js
    passport.js
  models/
  routes/
  services/
  views/
  public/
  uploads/
```

## Environment Configuration

Create a local `.env` file at the repository root and set the following variables.

| Variable | Required | Description |
| --- | --- | --- |
| PORT | No | Application port. Default: 3000 |
| SESSION_SECRET | Yes | Secret used to sign session data |
| DB_HOST | Yes | PostgreSQL host |
| DB_PORT | No | PostgreSQL port. Default: 5432 |
| DB_NAME | Yes | PostgreSQL database name |
| DB_USER | Yes | PostgreSQL username |
| DB_PASS | Conditionally | PostgreSQL password (use with DB_* variables) |
| DB_PASSWORD | Conditionally | Alternative PostgreSQL password key (supported alias for DB_PASS) |
| DATABASE_URL | Recommended for cloud | Full PostgreSQL connection URL (preferred on Render) |
| GOOGLE_CLIENT_ID | Optional | Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | Optional | Google OAuth client secret |
| RESEND_API_KEY | Optional | Resend API key for email notifications |
| BASE_URL | Optional | Public base URL for email action links |
| XAI_API_KEY | Optional | API key for AI assistant (xAI or Groq-compatible) |

## Local Development

### Prerequisites
- Node.js 18 or later
- PostgreSQL 13 or later
- npm

### Setup

```bash
npm install
```

### Start

Development mode:

```bash
npm run dev
```

Production-like mode:

```bash
npm start
```

Default local URL:

```text
http://localhost:3000
```

## Deployment

Deployment artifacts for Render are included in the repository:
- `render.yaml`
- `Procfile`

Recommended production controls:
- Use managed PostgreSQL with SSL/TLS enabled.
- Use a strong, rotation-ready `SESSION_SECRET`.
- Store secrets exclusively in platform-managed environment settings.
- Enforce HTTPS and maintain a stable `BASE_URL`.

## Security and Data Controls

- Passwords are never stored in plain text and are hashed with bcrypt.
- Authenticated routes are protected by Passport session validation.
- Sensitive credentials are externalized via environment variables.
- Duplicate import checks reduce accidental data duplication risk.
- Anomaly workflows support review-driven false-positive handling.

## Operational Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| Start | `npm start` | Starts the application in standard runtime mode |
| Dev | `npm run dev` | Starts the application with nodemon for local iteration |
| Test | `npm test` | Placeholder command (test suite not configured yet) |

## Roadmap

Planned or recommended enhancements:
- Automated test coverage across unit, integration, and route layers.
- Role-based access control and administrative auditing capabilities.
- Expanded statement import adapters for additional banking formats.
- Scheduled monthly summaries and digest notifications.
- Container-based deployment and CI/CD workflow standardization.

## License

This repository is currently licensed under ISC, as defined in package metadata.
