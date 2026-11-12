# Mobile Build & Publishing — NOT YET BUILT (Phase 8)

Planned design.
- Expo EAS builds using the customer's own Expo, Apple and Google accounts (`DeveloperAccount`, with encrypted credentials). Signing keys never leave encrypted storage and are never shown to AI agents.
- Build profiles (development / preview / production) produce IPA, APK and AAB artifacts stored in R2 (`BuildArtifact`).
- Release checklist: bundle ids, icons and splash, privacy declarations, App Store / Play metadata and screenshots.
- **The customer submits from their own developer account.** We never publish on a customer's behalf through prohibited third-party flows, and never promise approval.
- Apple App Review Guideline 4.2.6 (apps created from a commercialised template or app-generation service) is addressed by generating unique, customer-specific apps and by having each customer submit under their own account. Do not mass-produce identical apps.
