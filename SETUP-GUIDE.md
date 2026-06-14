# @disrptiv-exchange/apm-tool — Setup, Publish & Install Guide

This guide covers how to set up the GitHub repository, publish the library to GitHub Packages, and install/update it in consuming projects (glassrun-frontend, glassrun-delivery-app, glassrun-yard-app, etc.).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Create GitHub Repository](#2-create-github-repository)
3. [Initialize Git & Push Code](#3-initialize-git--push-code)
4. [Generate GitHub Personal Access Token](#4-generate-github-personal-access-token)
5. [Configure Library for GitHub Packages](#5-configure-library-for-github-packages)
6. [Build & Publish the Library](#6-build--publish-the-library)
7. [Configure Consuming App to Install from GitHub Packages](#7-configure-consuming-app-to-install-from-github-packages)
8. [Install the Library in Consuming App](#8-install-the-library-in-consuming-app)
9. [When You Make Changes to the Library](#9-when-you-make-changes-to-the-library)
10. [Install Updated Library in Consuming Apps](#10-install-updated-library-in-consuming-apps)
11. [Quick Reference Commands](#11-quick-reference-commands)

---

## 1. Prerequisites

- **Node.js** 20+ installed
- **npm** 9+ installed
- **Angular CLI** installed globally (`npm install -g @angular/cli`)
- **GitHub account** with access to the `Disrptiv-Exchange` organization
- **Git** installed

---

## 2. GitHub Repository

The repository already exists and is **public**: [Disrptiv-Exchange/glassrun-apm-tool](https://github.com/Disrptiv-Exchange/glassrun-apm-tool) (branches `main`, `dev`, `qa`). The library code is already pushed. The instructions below are kept for reference if the repo ever needs to be recreated.

### Option A: Using GitHub Web UI

1. Go to https://github.com/organizations/Disrptiv-Exchange/repositories/new
2. Fill in the details:
   - **Repository name**: `glassrun-apm-tool`
   - **Description**: `Application Performance Monitoring library for glassRUN Angular apps`
   - **Visibility**: Public
   - **Do NOT** initialize with README, .gitignore, or license (we already have code)
3. Click **Create repository**

### Option B: Using GitHub CLI (if installed)

```bash
gh repo create Disrptiv-Exchange/glassrun-apm-tool --public --description "APM library for glassRUN Angular apps"
```

---

## 3. Initialize Git & Push Code

Open a terminal and run:

```bash
cd D:\glassRUN_SaaS_Git\glassrun-apm

# Initialize git repository
git init

# Add all files
git add .

# Create the first commit
git commit -m "initial commit: @disrptiv-exchange/apm-tool library"

# Set the main branch name
git branch -M main

# Add the remote (replace with your actual repo URL)
git remote add origin https://github.com/Disrptiv-Exchange/glassrun-apm-tool.git

# Push to GitHub
git push -u origin main
```

---

## 4. Generate GitHub Personal Access Token

You need a token to publish and install packages from GitHub Packages.

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Fill in:
   - **Note**: `glassrun-packages`
   - **Expiration**: Choose an appropriate duration
   - **Scopes**: Check these boxes:
     - `read:packages` — to install packages
     - `write:packages` — to publish packages
     - `repo` — needed for private repos
4. Click **Generate token**
5. **Copy the token immediately** — you won't see it again

### Save the token for npm authentication

Run this command (replace `YOUR_TOKEN` with the actual token):

```bash
npm config set //npm.pkg.github.com/:_authToken YOUR_TOKEN
```

This saves the token in your user-level `.npmrc` file (`C:\Users\<YourName>\.npmrc`). You only need to do this **once per machine**.

---

## 5. Configure Library for GitHub Packages

### 5a. Update library package.json

Edit `D:\glassRUN_SaaS_Git\glassrun-apm\projects\apm-tool\package.json` and add the `repository` and `publishConfig` fields:

```json
{
  "name": "@disrptiv-exchange/apm-tool",
  "version": "1.0.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/Disrptiv-Exchange/glassrun-apm-tool.git"
  },
  "publishConfig": {
    "@disrptiv-exchange:registry": "https://npm.pkg.github.com"
  },
  "peerDependencies": {
    "@angular/common": "^20.0.0",
    "@angular/core": "^20.0.0",
    "@angular/router": "^20.0.0",
    "rxjs": "^7.8.0",
    "zone.js": "~0.15.0"
  },
  "optionalDependencies": {
    "@capacitor/app": "^7.0.0",
    "@capacitor/device": "^7.0.0"
  },
  "dependencies": {
    "tslib": "^2.3.0"
  },
  "sideEffects": false
}
```

### 5b. Create .npmrc in the library project root

Create file `D:\glassRUN_SaaS_Git\glassrun-apm\.npmrc`:

```
@disrptiv-exchange:registry=https://npm.pkg.github.com
```

This tells npm that any package under `@disrptiv-exchange/` scope should be published to GitHub Packages.

---

## 6. Build & Publish the Library

> **Preferred path — automated.** Publishing is wired through GitHub Actions ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)), exactly like glassGRID. Bump the version in `projects/apm-tool/package.json`, then push a `v*` tag (e.g. `git tag v1.0.1 && git push origin v1.0.1`). The workflow builds and publishes to GitHub Packages using the Actions-provided `GITHUB_TOKEN` — no personal token or `write:packages` scope required. You can also run it from the **Actions** tab. The steps below are the **manual fallback** (needs a PAT with `write:packages`).

Run these commands in order:

```bash
cd D:\glassRUN_SaaS_Git\glassrun-apm

# Step 1: Build the library
ng build apm-tool --configuration production

# Step 2: Go to the build output
cd dist/apm-tool

# Step 3: Publish to GitHub Packages
npm publish
```

**Expected output:**

```
+ @disrptiv-exchange/apm-tool@1.0.0
```

### Verify the package is published

Go to: https://github.com/orgs/Disrptiv-Exchange/packages

You should see `@disrptiv-exchange/apm-tool` listed there.

---

## 7. Configure Consuming App to Install from GitHub Packages

This step is done **once per project** that wants to use the library.

### Create or update .npmrc in the consuming app root

For example, in `D:\glassRUN_SaaS_Git\glassrun-frontend\.npmrc`, add:

```
@disrptiv-exchange:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

**For local development**, the token is already set in your user-level `.npmrc` (from Step 4), so this file just needs the registry line:

```
@disrptiv-exchange:registry=https://npm.pkg.github.com
```

**For CI/CD**, set the `GITHUB_TOKEN` environment variable in your CI pipeline with the GitHub token value.

### Repeat for each consuming app:
- `glassrun-frontend/.npmrc`
- `glassrun-delivery-app/.npmrc`
- `glassrun-yard-app/.npmrc`

---

## 8. Install the Library in Consuming App

```bash
cd D:\glassRUN_SaaS_Git\glassrun-frontend

# Install specific version
npm install @disrptiv-exchange/apm-tool@1.0.0

# OR install latest
npm install @disrptiv-exchange/apm-tool@latest
```

This will:
- Download the package from GitHub Packages
- Add it to `package.json` under `dependencies`
- Install it in `node_modules/@disrptiv-exchange/apm-tool/`

**Note:** If you previously used `npm link`, remove it first:

```bash
npm unlink @disrptiv-exchange/apm-tool
npm install @disrptiv-exchange/apm-tool@1.0.0
```

---

## 9. When You Make Changes to the Library

Follow these steps every time you update the library code:

### Step 1: Make your code changes

Edit files in `D:\glassRUN_SaaS_Git\glassrun-apm\projects\apm-tool\src\`

### Step 2: Bump the version

```bash
cd D:\glassRUN_SaaS_Git\glassrun-apm\projects\apm-tool

# For a bug fix (1.0.0 → 1.0.1)
npm version patch

# For a new feature (1.0.0 → 1.1.0)
npm version minor

# For a breaking change (1.0.0 → 2.0.0)
npm version major
```

### Step 3: Build the library

```bash
cd D:\glassRUN_SaaS_Git\glassrun-apm
ng build apm-tool --configuration production
```

### Step 4: Publish the new version

```bash
cd D:\glassRUN_SaaS_Git\glassrun-apm\dist\apm-tool
npm publish
```

### Step 5: Commit and push to GitHub

```bash
cd D:\glassRUN_SaaS_Git\glassrun-apm
git add .
git commit -m "release: v1.0.1 - description of changes"
git push origin main
```

---

## 10. Install Updated Library in Consuming Apps

After publishing a new version, update each consuming app:

```bash
cd D:\glassRUN_SaaS_Git\glassrun-frontend

# Update to a specific version
npm install @disrptiv-exchange/apm-tool@1.0.1

# OR update to latest
npm install @disrptiv-exchange/apm-tool@latest
```

Then **restart the dev server** if it was running:

```bash
# Stop the running server (Ctrl+C), then:
npm run start
```

### Verify the version installed

```bash
npm ls @disrptiv-exchange/apm-tool
```

Expected output:

```
glassRUNCustomerAPP@x.x.x
└── @disrptiv-exchange/apm-tool@1.0.1
```

---

## 11. Quick Reference Commands

### Publish a new version (run from library root)

```bash
cd D:\glassRUN_SaaS_Git\glassrun-apm

# 1. Bump version
cd projects/apm-tool && npm version patch && cd ../..

# 2. Build
ng build apm-tool --configuration production

# 3. Publish
cd dist/apm-tool && npm publish && cd ../..

# 4. Commit & push
git add . && git commit -m "release: vX.X.X" && git push origin main
```

### Install latest in any consuming app

```bash
npm install @disrptiv-exchange/apm-tool@latest
```

### Check what version is installed

```bash
npm ls @disrptiv-exchange/apm-tool
```

### Check what versions are published

```bash
npm view @disrptiv-exchange/apm-tool versions --registry=https://npm.pkg.github.com
```

---

## Troubleshooting

### Error: `401 Unauthorized` when publishing or installing

- Verify your GitHub token is set:
  ```bash
  npm config get //npm.pkg.github.com/:_authToken
  ```
- If empty, set it again:
  ```bash
  npm config set //npm.pkg.github.com/:_authToken YOUR_TOKEN
  ```
- Ensure the token has `read:packages`, `write:packages`, and `repo` scopes.

### Error: `404 Not Found` when installing

- Ensure `.npmrc` exists in the consuming app root with:
  ```
  @disrptiv-exchange:registry=https://npm.pkg.github.com
  ```
- Ensure the package has been published at least once.

### Error: `EPUBLISHCONFLICT` when publishing

- You're trying to publish a version that already exists.
- Run `npm version patch` (or `minor`/`major`) before publishing.

### Library changes not reflecting after install

- Verify the correct version is installed: `npm ls @disrptiv-exchange/apm-tool`
- Delete `node_modules` and reinstall:
  ```bash
  rm -rf node_modules
  npm install
  ```
- Restart the dev server.

### Switching from `npm link` to published package

```bash
npm unlink @disrptiv-exchange/apm-tool
npm install @disrptiv-exchange/apm-tool@latest
```
