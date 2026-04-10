# Testing Deployment Scripts

Deployment scripts are code too. An untested deployment script is a production incident waiting to happen.

## Testing Shell Scripts

```bash
#!/bin/bash
# test_deploy.sh

# Setup
TEMP_DIR=$(mktemp -d)
export DEPLOY_DIR="$TEMP_DIR"
export VERSION="1.2.3"

# Run deploy script
./deploy.sh

# Assertions
if [ ! -f "$DEPLOY_DIR/app-1.2.3/config.json" ]; then
  echo "FAIL: config not deployed"
  exit 1
fi

if [ "$(readlink "$DEPLOY_DIR/current")" != "$DEPLOY_DIR/app-1.2.3" ]; then
  echo "FAIL: symlink not updated"
  exit 1
fi

echo "PASS"
rm -rf "$TEMP_DIR"
```

## Docker Build Tests

Test that Docker images build correctly and contain expected files:

```bash
docker build -t myapp:test .
docker run --rm myapp:test node --version
docker run --rm myapp:test ls /app/dist/
```

## Rollback Testing

Test the rollback procedure. If a deployment fails, can you quickly revert to the previous version? This is as important as testing the forward deployment.

## Infrastructure as Code

If you use Terraform, Pulumi, or CDK, write tests for your infrastructure definitions. Tools like **Terratest** and **CDK assertions** make this possible.
