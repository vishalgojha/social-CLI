# Licensing Model

Social Flow uses an open-core licensing model.

## Default License (Open Source)

Unless explicitly marked otherwise, repository code and docs are licensed under MIT:

- See `LICENSE`
- This includes core CLI, gateway, SDK, and public OSS features.

## Commercial License Scope

Commercial-only components are governed by `LICENSE-COMMERCIAL.md`.
A file is commercial if either condition is true:

1. It includes SPDX marker: `LicenseRef-Social-Commercial`
2. It lives in a directory explicitly declared commercial:
   - `models-commercial/`

## Practical Rule

- If no commercial marker/scope exists, treat it as MIT.
- If commercial marker/scope exists, MIT does not apply to that file.

## Contributor Guidance

- Public community contributions should target MIT scope.
- Commercial scope should be maintained by the core product team unless a separate legal agreement is in place.

## Distribution Strategy

- Tier 1: MIT CLI + self-hosted gateway (free/open source)
- Tier 2: hosted cloud with BYOK + commercial extensions
- Tier 3: enterprise/on-prem custom commercial package

## Important Note

Releases already published under MIT remain MIT for those released files/versions.
Commercial terms apply to new commercial-scoped files from the point they are introduced and clearly marked.