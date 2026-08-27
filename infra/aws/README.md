# AWS account (§4.2)

Not provisioned yet — this needs a new AWS account under Organizations,
which only you can create (account creation is not something to automate
blind). Once it exists, this directory gets Terraform for:

- `farmermarket-media-prod` / `-staging` — public product & brand images, fronted by CloudFront.
- `farmermarket-documents-prod` / `-staging` — private KYC uploads: no public access, bucket policy denies unsigned requests, Object Lock in governance mode, lifecycle rules per the retention schedule (§13).
- IAM: one role per service, least privilege, no long-lived root keys.

Until then, local dev and staging use the MinIO service in the root
`docker-compose.yml`, which speaks the same S3 API — the portability rule
in §4.4 (storage only through the S3 API) means swapping the endpoint is
the entire migration.
