# Care ERP Configuration Guide

All Care ERP settings must be configurable through environment variables or admin settings. **Never hardcode configuration values.**

---

## Quick Reference

| Component | Variables | File | Default |
|-----------|-----------|------|---------|
| Database | `DATABASE_URL` | `.env` | PostgreSQL on localhost:5432 |
| API Server | `API_PORT`, `API_HOST` | `.env` | localhost:3000 |
| Orthanc DICOM | `ORTHANC_HOST`, `ORTHANC_PORT` | `.env` | localhost:8042 |
| OHIF Viewer | `OHIF_URL` | `.env` | /ohif |
| Weasis Viewer | `WEASIS_URL` | `.env` | /weasis |
| WhatsApp Business | `WHATSAPP_BUSINESS_API_KEY` | Encrypted in DB | Not set |
| Payment Gateway | `PAYMENT_GATEWAY_KEY` | Encrypted in DB | Not set |

---

## Database Configuration

### PostgreSQL Connection
```env
# Database URL (required)
DATABASE_URL=postgresql://user:password@localhost:5432/care_erp_db

# Connection pool settings (optional)
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20
DATABASE_TIMEOUT=30000
```

### Migrations
```bash
# Run pending migrations
pnpm db:migrate

# Rollback last migration
pnpm db:rollback

# Create new migration
pnpm db:new migration_name
```

---

## API Server Configuration

### Server Settings
```env
# Port and host (default: localhost:3000)
API_PORT=3000
API_HOST=localhost
API_PROTOCOL=http

# For production (Synology)
API_PORT=3000
API_HOST=0.0.0.0
API_PROTOCOL=https
```

### JWT & Authentication
```env
# JWT Secret (generate random string, store securely)
JWT_SECRET=your-random-secret-key-here-change-in-production

# JWT Expiration
JWT_EXPIRES_IN=7d

# Session settings
SESSION_TIMEOUT_MINUTES=60
```

### CORS Configuration
```env
# Allowed origins (comma-separated)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://192.168.1.137:3001

# For production
CORS_ORIGINS=https://your-domain.com,https://diagnostic-center.your-domain.com
```

---

## DICOM & Medical Imaging

### Orthanc PACS Server
```env
# Orthanc connection (default: localhost:8042)
ORTHANC_HOST=localhost
ORTHANC_PORT=8042
ORTHANC_PROTOCOL=http
ORTHANC_USERNAME=  # Leave empty if no auth
ORTHANC_PASSWORD=

# For production (Synology NAS)
ORTHANC_HOST=192.168.1.137
ORTHANC_PORT=8042
ORTHANC_PROTOCOL=http
```

### DICOM Storage Settings
```env
# Max DICOM file size (default: 500MB)
DICOM_MAX_FILE_SIZE=524288000

# DICOM modalities (comma-separated)
# Standard: CT,MRI,XR,US,CR,DX,OT
DICOM_MODALITIES=CT,MRI,XR,US,CR,DX,OT,RF,RG,KO,PR,RT

# Auto-cleanup old DICOM (days)
DICOM_RETENTION_DAYS=730
```

### OHIF Web Viewer
```env
# OHIF URL path (must be accessible from frontend)
OHIF_URL=/ohif
OHIF_INSTANCE_HOST=localhost:3000

# For production
OHIF_URL=https://your-domain.com/ohif
OHIF_INSTANCE_HOST=your-domain.com
```

### Weasis Desktop Viewer
```env
# Weasis URL (optional, for desktop clients)
WEASIS_URL=weasis://
WEASIS_SERVER=http://localhost:8042
```

---

## WhatsApp Business Integration

### API Configuration
```env
# WhatsApp Business API credentials
WHATSAPP_BUSINESS_API_KEY=your-api-key-here
WHATSAPP_BUSINESS_ACCOUNT_ID=your-account-id
WHATSAPP_BUSINESS_PHONE_NUMBER_ID=your-phone-id

# Webhook settings
WHATSAPP_WEBHOOK_URL=https://your-domain.com/api/whatsapp/webhook
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your-random-verify-token
```

### AI Caller Settings
```env
# AI Receptionist permissions (comma-separated)
AI_CALLER_PERMISSIONS=booking,inquiry,report_status,test_info

# Disable sensitive operations
AI_CALLER_DISABLE_DELETE=true
AI_CALLER_DISABLE_REFUND=true
AI_CALLER_DISABLE_RADIOLOGIST_SHARE=true
```

### Message Templates
```env
# WhatsApp message template names (pre-approved by WhatsApp)
WHATSAPP_TEMPLATE_BOOKING_CONFIRMATION=care_booking_confirmation
WHATSAPP_TEMPLATE_REPORT_READY=care_report_ready
WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER=care_reminder
```

---

## Payment Gateway Integration

### Provider Configuration
```env
# Payment provider (stripe, razorpay, paypal, etc.)
PAYMENT_PROVIDER=razorpay

# Razorpay (India)
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret

# Stripe (Global)
STRIPE_API_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# PayPal
PAYPAL_CLIENT_ID=your-client-id
PAYPAL_CLIENT_SECRET=your-client-secret
```

### Payment Settings
```env
# Allowed payment methods (comma-separated)
PAYMENT_METHODS=card,upi,netbanking,wallet

# Refund window (days after payment)
REFUND_WINDOW_DAYS=7

# Reconciliation schedule (cron format)
BILLING_RECONCILIATION_CRON=0 2 * * * # 2 AM daily
```

---

## Email & Notifications

### SMTP Configuration
```env
# Email provider
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# From address
EMAIL_FROM_NAME=Care Diagnostics
EMAIL_FROM_ADDRESS=noreply@carediagnostics.com

# Notification settings
EMAIL_ENABLE_REGISTRATION=true
EMAIL_ENABLE_REPORT_READY=true
EMAIL_ENABLE_APPOINTMENT_REMINDER=true
```

### SMS Configuration (Optional)
```env
# SMS provider (twilio, aws-sns, etc.)
SMS_PROVIDER=twilio

# Twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# Message settings
SMS_ENABLE_APPOINTMENT_REMINDER=true
SMS_REMINDER_HOURS_BEFORE=24
```

---

## Frontend & UI Configuration

### React App Settings
```env
# API endpoint (must be accessible from browser)
REACT_APP_API_URL=http://localhost:3000/api
REACT_APP_ORTHANC_URL=http://localhost:8042
REACT_APP_OHIF_URL=/ohif

# For production
REACT_APP_API_URL=https://your-domain.com/api
REACT_APP_ORTHANC_URL=https://your-domain.com/orthanc
REACT_APP_OHIF_URL=https://your-domain.com/ohif
```

### UI Features
```env
# Enable/disable features
UI_ENABLE_DARK_MODE=true
UI_ENABLE_PRINT=true
UI_ENABLE_PDF_EXPORT=true
UI_COMPACT_LAYOUT=true

# Page size defaults
UI_DEFAULT_PAGE_SIZE=20
UI_MAX_RESULTS_PER_QUERY=1000
```

---

## Logging & Monitoring

### Log Configuration
```env
# Log level (debug, info, warn, error)
LOG_LEVEL=info

# Log output
LOG_FORMAT=json
LOG_OUTPUT=stdout

# File logging (optional)
LOG_FILE_PATH=/var/log/care-erp/app.log
LOG_FILE_MAX_SIZE_MB=100
LOG_FILE_RETENTION_DAYS=30
```

### Health Checks
```env
# Health check settings
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_PATH=/health
HEALTH_CHECK_INTERVAL_SECONDS=30
```

### Performance Monitoring
```env
# Enable APM (Application Performance Monitoring)
APM_ENABLED=false
APM_SERVICE_NAME=care-erp
APM_SERVER_URL=http://localhost:8200
```

---

## Synology NAS Specific

### Docker & Compose
```env
# Synology NAS IP and ports
NAS_IP=192.168.1.137
NAS_API_PORT=3000
NAS_DATABASE_PORT=5432

# Synology uses different paths
DB_DATA_PATH=/volume1/docker/care-erp/postgres-data
APP_DATA_PATH=/volume1/docker/care-erp/app-data
DICOM_DATA_PATH=/volume1/docker/care-erp/dicom-data
```

### Performance
```env
# Docker container resources (Synology optimized)
DOCKER_MEMORY_LIMIT=2G
DOCKER_CPU_LIMIT=2

# Database optimization for Synology
PG_WORK_MEM=64MB
PG_EFFECTIVE_CACHE_SIZE=256MB
```

---

## Security Configuration

### HTTPS/SSL
```env
# Certificate paths
SSL_CERT_PATH=/etc/ssl/certs/your-cert.pem
SSL_KEY_PATH=/etc/ssl/private/your-key.pem

# HSTS (HTTP Strict Transport Security)
HSTS_MAX_AGE=31536000
```

### Encryption
```env
# Encryption key for sensitive data (generate random)
ENCRYPTION_KEY=your-random-encryption-key-64-chars

# Backup encryption
BACKUP_ENCRYPTION_ENABLED=true
BACKUP_ENCRYPTION_KEY=your-backup-encryption-key
```

### Rate Limiting
```env
# API rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MINUTES=15

# Login attempts
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
```

---

## Development vs Production

### Development (.env.local)
```env
NODE_ENV=development
DEBUG=true
LOG_LEVEL=debug
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/care_erp_dev
API_PORT=3000
ORTHANC_HOST=localhost
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Production (.env.production)
```env
NODE_ENV=production
DEBUG=false
LOG_LEVEL=info
DATABASE_URL=postgresql://user:secure-password@192.168.1.137:5432/care_erp
API_PORT=3000
API_HOST=0.0.0.0
ORTHANC_HOST=192.168.1.137
CORS_ORIGINS=https://your-domain.com
# All sensitive keys must be set
```

---

## How to Set Configuration

### Option 1: Environment File (.env)
```bash
# Copy template
cp .env.example .env

# Edit values
nano .env

# Start app (loads .env automatically)
docker-compose up
```

### Option 2: Docker Environment
```yaml
# docker-compose.yml
services:
  api:
    environment:
      DATABASE_URL: postgresql://user:pass@db:5432/care_erp
      API_PORT: 3000
      ORTHANC_HOST: orthanc
```

### Option 3: Admin Settings UI
- Login as admin
- Go to Settings > System Configuration
- Update values in database
- Restart services to apply

---

## Validation Checklist

### Before Deploying
- [ ] All `.env` variables set
- [ ] Database connection works
- [ ] Orthanc is reachable
- [ ] OHIF viewer loads
- [ ] WhatsApp API configured (if enabled)
- [ ] Payment gateway keys set (if enabled)
- [ ] SMTP credentials working
- [ ] SSL certificates valid (if using HTTPS)
- [ ] Firewall rules correct
- [ ] Backups configured

---

## Troubleshooting

### "Cannot connect to database"
```bash
# Check connection string
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

### "Orthanc not found"
```bash
# Check ORTHANC_HOST and ORTHANC_PORT
curl http://$ORTHANC_HOST:$ORTHANC_PORT/app/app.html
```

### "WhatsApp webhook not working"
```bash
# Verify URL is publicly accessible
curl https://your-domain.com/api/whatsapp/webhook

# Check verify token
curl -X GET "https://your-domain.com/api/whatsapp/webhook?hub.verify_token=YOUR_TOKEN"
```

---

## Security Best Practices

✅ **DO:**
- Store `.env` files securely (never commit to git)
- Rotate API keys regularly
- Use strong passwords for database
- Enable HTTPS in production
- Keep secrets in secure vaults
- Audit access logs regularly

❌ **DON'T:**
- Hardcode credentials in code
- Commit `.env` to repository
- Share API keys
- Use simple passwords
- Disable security features
- Run with DEBUG=true in production

---

*Last Updated: July 2, 2026*
