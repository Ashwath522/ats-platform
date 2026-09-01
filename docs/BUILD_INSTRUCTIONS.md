## Running Tests

The project includes test suites for fairness, load, and latency testing.

### Latency Tests

To run latency benchmarks for the risk engine:

```bash
python tests/latency/test_risk_engine_benchmark.py
```

### Load Tests

To run load and stability smoke tests:

```bash
python tests/load/test_concurrent_load.py
```

### All Tests

To run all test suites:

```bash
python tests/run_tests.py
```

### Test Targets

- **Risk Score Calculation Latency**: < 50ms (p50), < 100ms (p95) - measured in isolation
- **1 FPS Vision Processing**: ≤ 120–300 ms end-to-end latency
- **Fairness Principles**:
  - No systematic score increase due to glasses
  - Lighting conditions not over-weighted (follows 40/30/20/10 weighting)
  - Natural head movement/fidgeting within baseline not penalized

### Load Test Targets

- Handle 10+ concurrent sessions without crashes
- Process burst events (100+ events) without significant delay
- Maintain sustained load (5+ events/second) over extended periods

### Note on Test Implementation

The current latency numbers in the benchmark tests come from Python test doubles/stubs, not the production TypeScript/MediaPipe pipeline. These tests validate the correctness of the fairness principles and test harness. 

For production latency measurement, the full browser-based computer vision pipeline (including MediaPipe pose/face/object detection, frame capture, and signal processing) must be measured. The test doubles allow validation of the test structure and fairness principles while the real implementation is developed.

### Note on Test Determinism

All tests are designed to be deterministic where possible.
Tests that involve timing or randomness use fixed seeds or reasonable tolerance bounds.

## How to Run Locally

1.  Clone the repository and install dependencies:
    ```bash
    git clone <repository-url>
    cd ai-interview-main
    pnpm install
    ```

2.  Set up environment variables:
    - Copy `.env.example` to `.env` and fill in the required values.
    - The minimum required variables are:
        - `DATABASE_URL` (PostgreSQL connection string)
        - `BETTER_AUTH_SECRET` (for authentication)
        - `RESEND_API_KEY` (for sending emails)
        - Storage credentials (if using S3/MinIO for evidence storage)
    - See `infra/.env.example` for a complete list of variables.

3.  Start the development server:
    ```bash
    pnpm dev
    ```

4.  Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Production Readiness Notes

- **Latency Measurements**: The latency tests in this repository use Python test doubles. Production latency must be measured on the full TypeScript/MediaPipe pipeline in the browser.
- **Computer Vision Pipeline**: The CV pipeline uses MediaPipe and TensorFlow.js models. In production, ensure that the model files are properly bundled and served.
- **Evidence Storage**: The system stores short video clips and snapshots on proctoring events, not continuous raw video/audio. Configure the storage bucket and retention policy appropriately.
- **Security**: All API routes are protected by authentication middleware. Candidate routes are guarded to prevent access to recruiter/admin functionality.
- **Audit Log**: The audit log is append-only and stores all significant actions for compliance and debugging.
- **Known Limitations**:
    - The highlight-reel feature may be simplified in this version.
    - Load and latency tests use stubs for the core logic; production performance should be validated in a staging environment.
    - Some UI components (like the legacy InterviewRoom) are not used in the main flow but are present in the codebase.

## Current boundary: Steps 1–22 Complete

## Next step: Step 23 — Monitoring and observability
