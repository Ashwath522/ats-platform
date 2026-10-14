Real responses captured 2026-10-13 from the public SmartRecruiters Posting API
(https://api.smartrecruiters.com/v1/companies/{id}/postings?country=in), trimmed.
Verified live company ids with India postings that day: BoschGroup (611), Wabtec (122), Continental (12).
Adzuna / Jooble fixtures are built from their public API documentation (keys required for live calls).

Doc-based fixtures (shapes from the official API docs; values are illustrative):
- adzuna_search.json   — https://developer.adzuna.com/docs/search (GET /v1/api/jobs/in/search/1)
- jooble_search.json   — https://jooble.org/api/about (POST /api/{key})
- greenhouse_jobs.json — https://developers.greenhouse.io/job-board.html (GET /v1/boards/{token}/jobs?content=true)
- lever_postings.json  — https://github.com/lever/postings-api (GET /v0/postings/{company}?mode=json)
- ../live_resources/arxiv_feed.xml     — https://info.arxiv.org/help/api/user-manual.html (Atom feed)
- ../live_resources/youtube_search.json — https://developers.google.com/youtube/v3/docs/search/list
