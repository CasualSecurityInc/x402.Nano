# Fly.io Deployment Runbook for Demo Servers

This guide details how to set up, deploy, and automate the X402 demo server on [Fly.io](https://fly.io).

## 1. Prerequisites (Operator Setup)

First, you need a Fly.io account and the command-line utility.

1. **Sign Up / Login:** Go to [Fly.io](https://fly.io) and create an account. You will need to add a credit card to activate the free tier, even if you never exceed it.
2. **Install `flyctl`:**
   - **Mac (Homebrew):** `brew install flyctl`
   - **Linux:** `curl -L https://fly.io/install.sh | sh`
   - **Windows:** `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`
3. **Authenticate:** Run `fly auth login` in your terminal to connect the CLI to your account.

---

## 2. Initial Setup & Manual Creation

Instead of relying on the interactive `fly launch` wizard, we use declarative commands. This ensures our setup is repeatable (and easily portable to Terraform if needed later).

> [!IMPORTANT]
> **Working Directory:** All commands in this section assume you are running them from the **root directory of the monorepo** (e.g., `x402.Nano/`).

### Create the Server
1. Create the application container:
   ```bash
   fly apps create x402-demo-server-mainnet
   ```
2. Set the necessary environment secrets. *Replace the placeholder values with your actual Nano node details and secrets:*
   ```bash
    fly secrets set NANO_RPC_URL="https://rpc.yournode.com" \
                    NANO_SERVER_ADDRESS="nano_1..." \
                    NANO_TEST_SEED="YOUR_64_HEX_SEED_HERE" \
                    NANO_DEMO_ADDRESS_START_INDEX="1" \
                    NANO_DEMO_ADDRESS_POOL_SIZE="8" \
                    NANO_SERVER_PRIVATE_KEY="YOUR_PRIVATE_KEY_HERE" \
                    --app x402-demo-server-mainnet
   ```
3. Deploy the application using the predefined script in `site/package.json`:
   ```bash
   pnpm --dir site run deploy:fly:mainnet
   ```

---

## 3. CI/CD Integration (Automated Deployment)

Once you have verified the deployments work manually, you should automate deployments via GitHub Actions so the servers update whenever `main` changes.

### Step 3.1: Generate a Fly API Token
Generate an access token that GitHub Actions can use to deploy on your behalf:
```bash
fly tokens create deploy -x 999999h
```
*Copy the returned token immediately; you will not be able to view it again.*

### Step 3.2: Configure GitHub Secrets
1. Go to your GitHub repository -> **Settings** -> **Secrets and variables** -> **Actions**.
2. Click **New repository secret**.
3. Name: `FLY_API_TOKEN`
4. Secret: Paste the token you generated above.

### Step 3.3: Update GitHub Actions Workflow
In your `.github/workflows/deploy.yml` (or create a new `deploy-backends.yml`), you can now add a job to deploy the backend automatically:

```yaml
jobs:
  deploy-fly:
    name: Deploy to Fly.io
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - name: Deploy
        run: pnpm --dir site run deploy:fly:mainnet
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

## Useful Commands for Operators
- **Check server logs**: `fly logs --app x402-demo-server-mainnet`
- **Check application status**: `fly status --app x402-demo-server-mainnet`
- **SSH into the container**: `fly ssh console --app x402-demo-server-mainnet`
