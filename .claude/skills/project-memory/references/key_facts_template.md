# Key Facts Template

This file demonstrates the format for storing project constants, configuration, and frequently-needed **non-sensitive** information. Organize by category using bullet lists.

## SECURITY WARNING: What NOT to Store Here

**NEVER store passwords, API keys, or sensitive credentials in this file.** This file is typically committed to version control and should only contain non-sensitive reference information.

**NEVER store:**
- Passwords or passphrases
- API keys or authentication tokens
- Service account JSON keys or credentials
- Database passwords
- OAuth client secrets
- Private keys or certificates

**SAFE to store:**
- Database hostnames, ports, and cluster names
- Project identifiers and names
- API endpoint URLs (public URLs only)
- Service account email addresses (not the keys!)
- Cloud project IDs and region names
- Environment names and deployment targets
- Local development ports

**Where to store secrets:**
- `.env` files (excluded via `.gitignore`)
- Password managers
- Secrets managers (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault)
- CI/CD environment variables (GitHub Secrets, GitLab Variables)

## Example Structure

### Project Information

- Project Name: `my-project`
- Repository: `github.com/org/my-project`
- Tech Stack: Node.js, Express, PostgreSQL, Next.js
- Deployment: Vercel (frontend), Render (backend)

### Database Configuration

- Host: `db.example.com`
- Port: `5432`
- Database Name: `myproject`
- Connection: Use connection string from `.env`

### API Configuration

- Production URL: `https://api.myproject.com`
- Staging URL: `https://api-staging.myproject.com`
- Local Development: `http://localhost:3010`

### Local Development Ports

- Backend API: `3010`
- Frontend: `3000`
- Database: `5432`
- Redis: `6379`

### Important URLs

- API Documentation: `https://api.myproject.com/docs`
- CI/CD Pipeline: `https://github.com/org/my-project/actions`
- Monitoring: `https://dashboard.example.com`

### Team & Access

- GitHub Organization: `my-org`
- CI/CD: GitHub Actions
- Hosting: Vercel + Render

## Tips

- Keep entries current (update when things change)
- Remove deprecated information after migration is complete
- Include both production and development details
- Add URLs to make navigation easier
- Use consistent formatting
- Group related information together
- Mark deprecated items clearly with dates
