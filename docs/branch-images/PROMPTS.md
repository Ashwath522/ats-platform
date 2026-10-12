# Branch photos — generation prompts

The app already shows approved imagery for every branch (cropped from the
design pack). Branches without their own large photo (Civil, Electrical,
Chemical, Aerospace, Automobile, Metallurgy) currently use the plant/hard-hat
photo or a collage of their approved thumbnails. Generate the photos below in
any image tool (ChatGPT, Gemini, Midjourney, Firefly…) to give each branch its
own banner.

## Where to put the files

```
frontend/src/assets/branches/<branch-id>/hero.jpg        ← used on every student page banner
frontend/src/assets/branches/<branch-id>/<page>.jpg      ← optional, overrides one page
frontend/src/assets/branches/<branch-id>/thumb-1.jpg …   ← optional card thumbnails (thumb-1…thumb-6)
```

`<branch-id>` = `mechanical, civil, eee, ece, chemical, aerospace, automobile, metallurgy`
`<page>` = `dashboard, profile, resume, projects, opportunities, applications, interview, resources, settings`

No code change is needed — the build picks them up automatically
(`src/branding/branches.js`). Recommended: **1600 × 500 px JPG, under 250 KB**
for heroes; **640 × 360** for thumbnails.

## Shared style (paste before every prompt)

> Photorealistic cinematic photograph, wide 16:5 banner. Young Indian
> engineering student(s), early twenties, wearing a dark navy shirt, focused
> and working with their hands. Moody modern engineering lab or site, cool
> blue ambient light with a few warm practical lights, shallow depth of
> field, subtle bokeh. Subject and equipment on the RIGHT 60% of the frame;
> LEFT 40% darker, low-detail navy shadow so white headline text can sit on
> it. Natural skin tones, realistic hands, no text, no logos, no watermarks,
> no brand names.

## Per-branch heroes

| Branch | File | Prompt (after the shared style) |
|---|---|---|
| Civil | `civil/hero.jpg` | A civil engineering student in a hard hat and navy shirt reviewing structural drawings on a tablet beside a scale model of a steel-frame building and a total-station surveying instrument; site office window with a construction site and tower crane at golden hour in the background. |
| Electrical (EEE) | `eee/hero.jpg` | An electrical engineering student testing a three-phase control panel with a multimeter; PLC modules, contactors and neatly labelled wiring; an oscilloscope and a small solar-inverter test rig glowing on the bench. |
| Electronics & Comm. (ECE) | `ece/hero.jpg` | *(already approved: chip-design lab photo)* — optional alternative: an ECE student soldering an SMD component on a green PCB under a magnifier lamp, logic analyser and FPGA board beside, chip-layout CAD on a monitor. |
| Chemical | `chemical/hero.jpg` | A chemical engineering student in safety glasses adjusting a valve on a pilot-scale distillation column with glass vessels, flow meters and stainless piping; a process flow diagram (P&ID) on a monitor. |
| Aerospace | `aerospace/hero.jpg` | An aerospace engineering student positioning a white airfoil model inside a small transparent wind-tunnel test section; CFD pressure-contour simulation of a wing on a monitor; drone airframe on the bench. |
| Automobile | `automobile/hero.jpg` | An automobile engineering student inspecting an electric-vehicle motor and battery pack on a test stand in a vehicle lab; a car chassis on a lift in the softly lit background; CAD of a suspension on a laptop. |
| Metallurgy & Materials | `metallurgy/hero.jpg` | A materials engineering student examining a polished metal sample under a metallurgical microscope; a universal testing machine and heat-treatment furnace with a faint orange glow in the background; grain-structure micrograph on a monitor. |
| Mechanical | `mechanical/hero.jpg` | *(already approved: CAD/robotics lab photo)* — no action needed. |

## Thumbnails (optional, 640 × 360, 16:9, no people needed)

Use the shared style but replace the composition with "product-style studio
shot on a soft grey background":

- **Civil:** steel-frame building model · concrete cube in a compression tester · road cross-section model
- **Electrical:** control panel with PLC · transformer cut-away model · solar panel with charge controller
- **ECE:** green PCB close-up · FPGA dev board · antenna array on a test fixture
- **Chemical:** glass distillation setup · heat-exchanger cut-away · reactor vessel model
- **Aerospace:** airfoil in wind tunnel · turbofan engine cut-away · quadcopter airframe
- **Automobile:** EV battery module · gearbox cut-away · disc brake assembly
- **Metallurgy:** polished metal specimen · micrograph print · tensile test specimen after fracture

Name them `thumb-1.jpg … thumb-6.jpg` inside the branch folder.
