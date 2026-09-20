# IRIS LUMERA LMS — Product Roadmap

The current repository is the core free LMS foundation. The design intentionally leaves clear extension points so the product can grow without replacing the underlying D1/R2 model.

## Next build wave

### Employee operations
- Bulk learner import/export with CSV validation
- Cohorts, teams and departments
- Manager views and team-level learning reports
- Account lock/recovery flows
- Optional email-based password reset
- Optional SSO/OIDC adapter

### Learning operations
- Drag-and-drop module/lesson ordering persisted server-side
- Learning paths and prerequisite rules
- Deadlines, reminders and compliance windows
- Course versioning and learner-safe publishing
- Rich lesson authoring and reusable content blocks
- Additional SCORM 2004 CMI data coverage
- Optional xAPI/LRS adapter

### Assessments
- Question banks and randomized tests
- Attempts, retakes and review rules
- Weighted scoring and section scoring
- Assessment analytics
- Survey / feedback lesson type

### Credentials
- Multiple certificate families
- Signature/stamp/image layers
- Verification page and public verification code
- Printable and downloadable PDF pipeline
- Certificate expiry and renewal rules

### Gamification
- Configurable XP rules by course/module/lesson/assessment
- Badges and achievement designer
- Streaks
- Leaderboards by cohort/team
- Milestones and learning challenges

### Admin intelligence
- Learner 360 dashboard
- Course funnel analytics
- Completion heatmaps
- Department comparisons
- At-risk learner lists
- Exportable reports
- Audit filters and retention settings

### Product polish
- Responsive mobile-first experience
- PWA/offline shell where appropriate
- Accessibility pass (WCAG-focused)
- Keyboard-first admin workflows
- Theme/brand editor
- Empty, loading and failure states for every major workflow

## Free-first operating principle

Keep the default build free of AI and paid API dependencies. Use Cloudflare-native primitives and browser capabilities first. Add external services only as optional adapters when a business requirement cannot reasonably be met inside the free/self-hostable core.
