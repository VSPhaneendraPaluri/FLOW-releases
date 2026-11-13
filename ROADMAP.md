# FLOW — Roadmap

> Status matrix for features, platform coverage, and documentation.
> Updated as priorities shift. Honest over polished.

---

## Legend

| Symbol | Meaning             |
|:------:|---------------------|
|   ✅   | Done — shipped      |
|   🔄   | In progress         |
|   📋   | Planned             |
|   🤔   | Considering         |
|   ❌   | Not planned (yet)   |

---

## Stability & Correctness

| Item                                                                       | Status |
|----------------------------------------------------------------------------|:------:|
| Core grammar engine — directed and constrained-random generation           |   ✅   |
| Seed-reproducible output (`--seed`)                                        |   ✅   |
| `.flow` script: `scene`, `directed`, `random`, `loop`, `exclude`           |   ✅   |
| `.rules` constraint envelope                                               |   ✅   |
| Grammar engine hardening — edge-case coverage and deterministic behaviour  |   🔄   |
| Tester feedback loop — grammar fixes from early adoption                   |   🔄   |
| `flow_validate` — improved diagnostics and `.rules` coverage               |   🔄   |

---

## Plugin & ISA Support

| Item                                                                  | Status |
|-----------------------------------------------------------------------|:------:|
| Dynamic plugin loading (`--plugin`)                                   |   ✅   |
| Zero-C++ YAML ISA definition (`--isa-dir`)                            |   ✅   |
| Tier A — full instruction table, register file, tags, mix weights     |   ✅   |
| Tier B — encoding step for split immediates and PC-relative targets   |   ✅   |
| Tier C — cross-operand validation                                     |   ✅   |
| Tier D — full C++ plugin                                              |   ✅   |
| TableGen import — generate YAML plugin from LLVM `.td` file           |   📋   |
| More YAML starter examples (RISC-V-style, ARM-style, VLIW)            |   📋   |
| Better YAML schema error messages                                     |   📋   |

---

## Platform Coverage

| Item                              | Status |
|-----------------------------------|:------:|
| Linux x86-64 binary               |   ✅   |
| Windows x64 binary                |   ✅   |
| macOS x86-64 binary               |   🤔   |
| macOS ARM64 (Apple Silicon) binary|   🤔   |
| Linux ARM64 binary                |   🤔   |

---

## Documentation

| Item                                                            | Status |
|-----------------------------------------------------------------|:------:|
| Plugin authoring guide (all four tiers)                         |   ✅   |
| YAML schema reference                                           |   ✅   |
| Starter plugin templates                                        |   ✅   |
| Worked example with toy ISA                                     |   ✅   |
| End-to-end example with a real-world ISA shape                  |   📋   |
| Migration guide — moving from an existing generator to FLOW     |   ❌   |

---

## Not Planned (yet)

| Item                                                    | Status |
|---------------------------------------------------------|:------:|
| Simulator-specific integration guides (Spike, gem5, QEMU) |   ❌   |
| GUI or web-based script editor                          |   ❌   |

---

> Have a use case or ISA that FLOW doesn't cover well? Reach out via the blog or watch this repo for updates.
