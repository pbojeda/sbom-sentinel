# Key Project Facts

Quick reference for project configuration, infrastructure details, and important URLs.

## Security Warning

**DO NOT store in this file:** Passwords, API keys, secret tokens, private keys.
**SAFE to store:** Hostnames, ports, project IDs, public URLs, architecture notes.

---

## Project Configuration

- **Project Name**: sbom-sentinel
- **Description**: sbom-sentinel es una herramienta CLI open-source en TypeScript que automatiza la generación de SBOMs (Software Bill of Materials) en formato CycloneDX y el escaneo de vulnerabilidades para múltiples repositorios. Está diseñada para ejecutarse como tarea programada (CronJob de Kubernetes, cron local, CI/CD) y notificar por Slack y email cuando se detectan vulnerabilidades críticas o altas, o cuando el propio proceso falla
- **Repository**: [URL]
- **Primary Language**: TypeScript
- **Branching Strategy**: github-flow <!-- Options: github-flow | gitflow — See .claude/skills/development-workflow/references/branching-strategy.md -->

## Technology Stack

- **Backend**: Express, Node.js
- **Frontend**: [Framework, version]
- **Database**: PostgreSQL, localhost, 5432
- **ORM**: Prisma

## Local Development

- **Backend Port**: 3010
- **Frontend Port**: [e.g., 3000]
- **Database Port**: 5432
- **API Base URL**: http://localhost:3010/api

## Infrastructure

- **CI/CD**: [e.g., GitHub Actions]
- **Frontend Hosting**: [e.g., Vercel]
- **Backend Hosting**: [e.g., Render]
- **Database Hosting**: [e.g., Neon, Supabase, RDS]

## Important URLs

- **Production**: [URL]
- **Staging**: [URL]
- **API Docs**: [URL]

## Reusable Components

### Backend
- [List key services, middleware, validators as you build them]

### Frontend
- [List key components, hooks, stores as you build them]
