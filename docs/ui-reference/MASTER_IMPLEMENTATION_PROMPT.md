CORELINK — MASTER IMPLEMENTATION PROMPT
Use this prompt with the approved image pack and the existing CoreLink repository.

ROLE
You are a senior frontend engineer and UI implementation specialist. Implement the approved CoreLink screens as real, responsive application pages. The supplied images are the approved visual source of truth. Match their layout, spacing, typography, colors, component hierarchy, imagery, card styles, borders, shadows, and responsive behavior as closely as possible.

FIRST: INSPECT THE EXISTING PROJECT
1. Inspect the repository structure, package.json, routes, current page components, shared layouts, CSS conventions, and existing API/auth services before editing.
2. Keep the existing framework and project conventions. If this project is React + Vite, use the existing JSX/TSX component pattern and CSS setup; do not replace it with a different framework or create an unrelated standalone app.
3. Reuse the existing components, design tokens, icons, services, and route patterns wherever possible. Do not duplicate navigation bars or create separate incompatible styling systems for each page.
4. Do not change the backend contract, database schema, API endpoint names, token storage, or authentication flow just to make the UI easier.

APPROVED REFERENCES AND ASSETS
Use the exact supplied files under `assets/images/` and follow the page order and route mapping in `manifest.csv` and the PDF.
- Public landing page: `assets/images/01-landing-page.png`
- Student login: `assets/images/02-student-login.png`
- Recruiter login: `assets/images/03-recruiter-login.png`
- Student dashboard: `assets/images/04-student-dashboard.png`
- My Profile: `assets/images/05-my-profile.png`
- Resume & Skills: `assets/images/06-resume-and-skills.png`
- Projects: `assets/images/07-projects.png`
- Opportunities: `assets/images/08-opportunities.png`
- Applications: `assets/images/09-my-applications.png`
- AI Interview: `assets/images/10-ai-interview-preparation.png`
- Resources: `assets/images/11-learning-resources.png`
- Student Settings: `assets/images/12-student-settings.png`
- Recruiter Dashboard: `assets/images/13-recruiter-dashboard.png`
- Jobs & Requisitions: `assets/images/14-jobs-and-requisitions.png`
- Candidate Management: `assets/images/15-candidate-management.png`
- Applications Management: `assets/images/16-applications-management.png`
- Shortlisted Candidates: `assets/images/17-shortlisted-candidates.png`
- Interview Management: `assets/images/18-interview-management.png`
- Offers & Hiring: `assets/images/19-offers-and-hiring.png`
- Company Profile: `assets/images/20-company-profile.png`
- Recruiter Analytics: `assets/images/21-recruiter-analytics.png`
- Recruiter Settings: `assets/images/22-recruiter-settings.png`
- Admin Dashboard: `assets/images/23-admin-dashboard.png`
- User Management: `assets/images/24-user-management.png`

IMAGE USAGE RULE — IMPORTANT
Treat each full screenshot as the design reference for its matching route; do not simply stretch a full-page screenshot as the entire page background. Rebuild the visible interface using real HTML/JSX elements and CSS so controls, forms, tables, filters, tabs, navigation, and responsive layouts actually work.
Where a page uses photographic/illustrative imagery, use the matching approved image asset consistently rather than generating or substituting a different image. Keep asset paths identical and stable in JSX/HTML and CSS references; for example, use the same `/assets/images/...` URL in an `<img>` element or a CSS `background-image` rule when that same visual is required. Do not use one page's screenshot as another page's hero image. Do not invent replacement photos, branch illustrations, or branding. If a separate crop is needed, derive it from the approved image and keep the original approved screenshot unchanged in the reference pack.

DESIGN SYSTEM
- Keep the established CoreLink logo/brand and blue, navy, white, and pale-blue visual language.
- Use a shared typography scale, spacing scale, button styles, form fields, badges, tables, card radii, and subtle shadows.
- Maintain consistent sidebar widths, top-bar height, active navigation states, content gutters, and page heading hierarchy.
- Make every page responsive for desktop, tablet, and mobile. On narrow screens, collapse or adapt the sidebar, stack cards, keep tables usable with horizontal scrolling or mobile row cards, and prevent clipped content.
- Use accessible labels, keyboard focus states, semantic headings, appropriate contrast, and real button/link elements.
- Match the selected screenshot's page content. Do not add unrelated cards, branch lists, or extra sections to the two login pages: student login stays a simple student sign-in page with the approved chip-design team visual; recruiter login stays a simple recruiter/HR sign-in page with the approved recruiter visual.

PAGE-BY-PAGE IMPLEMENTATION
Implement all 24 routes/screens in the sequence in the PDF and manifest. Each page should have the exact tab name, page structure, and primary actions shown in its reference. Shared navigation should connect the pages. Candidate, recruiter, and admin areas must be visually distinct but use the same CoreLink design system.
- Public landing: explain CoreLink for core engineering careers; provide student and recruiter entry points.
- Student login: email/password, sign in, sign up, and forgot-password interactions; keep the form visually minimal.
- Recruiter login: recruiter-specific sign-in and contact/registration route, visually separate from student login.
- Student dashboard: profile/resume score, shortcuts, opportunities, application status, and progress.
- My Profile: editable personal/education details, skills, resume, portfolio, projects, and achievements.
- Resume & Skills: upload/replace resume, AI analysis state, suggestions, skill tags, certifications, proficiency.
- Projects: create/edit project, project category, attachments, verification status, project cards.
- Opportunities: search/filter jobs and internships, save jobs, view details, branch-neutral opportunities.
- Applications: track application status and upcoming interviews.
- AI Interview: technical/domain/HR practice, mock interview entry, readiness and progress.
- Resources: searchable branch-specific notes/tutorials/project references.
- Student Settings: account, privacy, security, notifications, and career preferences.
- Recruiter Dashboard: hiring KPIs, matching candidates, recent activity, and quick actions.
- Jobs & Requisitions: create/edit/close jobs, use templates, set eligibility and role criteria.
- Candidate Management: search and inspect profiles, compare candidates, shortlist and schedule interviews.
- Applications Management: filter applicants by job/status/branch and apply bulk actions.
- Shortlisted Candidates: manage shortlisted pipeline and interview next steps.
- Interviews: calendar/list, rounds, scheduling, interviewer assignment, and feedback.
- Offers & Hiring: generate/send offers, track decisions, compensation, and joining.
- Company Profile: branding, company details, locations, hiring domains, media, and team.
- Recruiter Analytics: date-filtered hiring charts, conversions, sources, and exports.
- Recruiter Settings: team roles, security, notifications, integrations, company settings.
- Admin Dashboard: platform-wide analytics, company/user summaries, system health, moderation flags.
- User Management: search, verify, edit, suspend/reactivate, reset access, and view activity.

FUNCTIONAL REQUIREMENTS
1. All visible controls must work: navigation, forms, search, tabs, filters, pagination, sort, modal/dialog actions, upload controls, profile edits, bookmarks, shortlist actions, and status changes.
2. Use real application state and existing backend endpoints where available. Do not display buttons that do nothing; if a backend operation is not yet available, provide a clearly labelled frontend-only state and document the missing integration.
3. Keep role-based routes and permissions. Candidate users should not access recruiter/admin pages, and recruiters should not access admin pages.
4. Use loading, empty, success, and error states for API-backed actions. Validate form input and display useful messages.
5. Avoid hard-coded fake analytics if real API data exists. Use existing API data; otherwise label demo/mock data explicitly and isolate it so it can be replaced.
6. Preserve the current candidate authentication flow and its endpoint contract. The existing candidate login/register flow uses the `/api/candidate/auth/login` and `/api/candidate/auth/register` endpoints with form-data credentials, stores the returned token through the existing candidate auth helper, and navigates to `/candidate/feed` after successful login. Preserve this flow unless repository inspection shows it has since been intentionally changed. Password validation must respect the backend's minimum length requirement. Inspect the current code before modifying it.
7. Do not expose secrets, tokens, credentials, or private environment values in the UI or logs.

IMPLEMENTATION WORKFLOW
1. Build or refine the shared design system and role-specific layouts first.
2. Implement the pages in small batches following the numbered references.
3. After each page, compare the browser rendering side-by-side with the corresponding approved screenshot and adjust spacing, sizes, image crop, typography, and responsive behavior.
4. Test desktop and mobile widths, route transitions, authentication, empty/loading/error states, and the main interactions.
5. Run the repository's existing lint/build/test commands. Fix regressions before finishing.
6. Do not stop after building only one page. Complete every route in the pack and provide a summary of implemented routes, changed files, test/build results, and any blocked backend integrations.

DELIVERABLES
- Working implementation for all 24 screens, not only a screenshot or static mockup.
- Reusable components and styles rather than duplicated one-off code.
- Stable references to the approved image assets.
- A route/page checklist showing completion state.
- A concise report of files changed, tests run, and remaining gaps.
