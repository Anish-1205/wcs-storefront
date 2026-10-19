# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub: **Security →
Report a vulnerability** on this repository (private vulnerability
reporting). Do not open a public issue.

Include what you found, how to reproduce it, and what it affects. You will get
an acknowledgement within a few days. Please give us reasonable time to fix
an issue before disclosing it.

## Scope

This repository is the storefront and admin panel for weaversclubsarees.com.
In scope: the code here and the deployed site. Out of scope: denial of
service, social engineering, and findings in third-party services (Supabase,
Vercel, Cloudinary, Upstash, Meta) that are not caused by how this code uses
them.

## Secrets

Real credentials never belong in this repository. A secret scan (gitleaks)
runs on every push and pull request. If one is committed anyway, treat it as
leaked: rotate it first (`docs/runbooks/secrets-and-keys.md`), then remove it.
