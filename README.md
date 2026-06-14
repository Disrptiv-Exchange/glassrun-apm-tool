# @disrptiv-exchange/apm-tool

Application Performance Monitoring library for glassRUN Angular apps. Published to **GitHub Packages** and consumed by `glassrun-frontend`, `glassrun-delivery-app`, `glassrun-yard-app`, and any other Angular app in the org.

Repository: [Disrptiv-Exchange/glassrun-apm-tool](https://github.com/Disrptiv-Exchange/glassrun-apm-tool)

---

## Installation (in a consumer app)

The package lives on GitHub Packages, which requires authentication even for public packages.

**1. Add a `.npmrc` to the consumer project root** (template: [`.npmrc.example`](.npmrc.example)):

```
@disrptiv-exchange:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

**2. Set `GITHUB_TOKEN`** to a personal access token with the `read:packages` scope (create one at https://github.com/settings/tokens):

```bash
export GITHUB_TOKEN=ghp_xxx
```

**3. Install:**

```bash
npm install @disrptiv-exchange/apm-tool
```

From here it behaves like any other npm dependency. Gitignore your real `.npmrc` if it ever contains a hard-coded token (the template uses `${GITHUB_TOKEN}`, so it is safe to commit).

---

## Publishing a new version

Publishing is automated. The [`publish.yml`](.github/workflows/publish.yml) workflow builds `apm-tool` and publishes it to GitHub Packages whenever you push a `v*` tag (it uses the Actions-provided `GITHUB_TOKEN`, so no personal token or `*:packages` scope is needed for the automated path).

```bash
# 1. bump the library version
cd projects/apm-tool && npm version patch   # or minor / major  -> e.g. 1.0.1
cd ../..

# 2. commit, tag, push
git add projects/apm-tool/package.json
git commit -m "release: v1.0.1 — <one-line summary>"
git tag v1.0.1
git push origin <branch> && git push origin v1.0.1
```

The tag push triggers the workflow, which syncs the version from the tag, builds, and publishes `@disrptiv-exchange/apm-tool@1.0.1`.

You can also trigger it manually from the **Actions** tab via **Run workflow** (optionally passing a version).

> **Note:** the workflow file must exist on the repository's **default branch** for tag-triggered and manual runs to be picked up.

### Manual publish (fallback)

Requires a PAT with `write:packages`:

```bash
npx ng build apm-tool --configuration production
cd dist/apm-tool
npm publish
```

---

## Local development

```bash
npm install
npx ng build apm-tool --configuration production   # build the library -> dist/apm-tool
```

## Repository layout

```
glassrun-apm-tool/
├── .github/workflows/publish.yml   # auto-publishes on v* tag (GitHub Packages)
├── .npmrc                          # publish-side scope -> registry mapping
├── .npmrc.example                  # consumer-side template (copy into consuming apps)
├── SETUP-GUIDE.md                  # full step-by-step setup / publish / install guide
├── angular.json
└── projects/
    └── apm-tool/                   # the publishable library
        ├── package.json            # @disrptiv-exchange/apm-tool
        ├── ng-package.json
        └── src/
```
