# CloudTax Pilot — Test Credentials

> ⚠️ This file is `.gitignore`d. Never commit it.

## Production admin
- Email: `nim@cloudtax.ca`
- Password: (user-set — rotated outside this session, not stored here)
- 2FA: ENFORCED. First login after launch will require email OTP. "Trust this device" cookie skips OTP for 30 days on the same browser.

## Backup admin (optional — remove if not needed)
- Email: `accountantnim@yopmail.com`
- Role: ADMIN (created during preview testing)

## After launch cleanup
All non-admin demo users were wiped via `POST /api/admin/prepare-for-launch`. No preserved test accounts.
