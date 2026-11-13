# FLOW — Instruction Stream Generator

> **Write what you want to run. FLOW generates what the architecture allows.**

FLOW is an instruction stream generator for CPU modelling, virtual prototyping,
and SoC platform simulation. Describe your architecture and address space — FLOW
produces legal, varied, seed-reproducible instruction sequences for any ISA and
any platform. No generator to maintain. No boilerplate to rebuild when the
architecture changes.

---

## Who uses FLOW?

| You are… | FLOW gives you… |
|---|---|
| **Virtual prototyping / CPU modelling engineer** | Realistic instruction traffic for your ISS or cycle-accurate model — across ISA variants, without rebuilding the generator each time |
| **SoC platform engineer** | Workload sequences that respect your platform's address map — legal load/store traffic for cache, interconnect, and power stress |
| **Performance architect** | Repeatable, seed-fixed workload mixes to characterise and compare micro-architecture models across runs and teams |
| **ISA designer** | Instruction generation before RTL or simulation is complete — validate the architecture definition as you author it |
| **CPU / SoC verification engineer** | Directed and constrained-random streams for DUT stimulus, with guaranteed legality and bit-exact reproducibility |

---

## What is in a release?

Each archive contains everything you need:

```
flow-sdk-<version>-<platform>.zip
├── bin/
│   ├── flow-linux-x86_64                  Linux x86-64 generator CLI
│   ├── flow-windows-x86_64.exe            Windows x86-64 generator CLI
│   ├── flow_validate-linux-x86_64         Linux x86-64 script validator
│   └── flow_validate-windows-x86_64.exe   Windows x86-64 script validator
├── include/flow/isa/     ISA SDK headers (MIT-licensed)
├── cmake/                CMake helpers for building ISA plugins
├── docs/                 Plugin authoring guide
├── templates/            Starter plugin templates
├── examples/             Worked example with a toy ISA
├── LICENSE               MIT license (SDK)
├── LICENSE-BIN           Binary terms (platform binaries)
└── NOTICE                Plain-English license summary
```

---

## Download

👉 **[Latest release →](../../releases/latest)**

Both **Linux (x86-64)** and **Windows (x64)** binaries ship in every archive.

---

## Quick Start

### Zero C++ — YAML ISA definition

Describe your ISA in two files and point FLOW at them. No build step required.

```
my_isa/
├── instructions.yml
└── registers.yml
```

```bash
flow --isa-dir my_isa/  my_test.flow
```

> YAML files must follow the FLOW schema — see `sdk/docs/yaml-plugin.md` in
> the archive for the full field reference.

### Compiled ISA plugin

For architectures with custom encodings or cross-operand constraints, build a
plugin from the MIT-licensed SDK headers and load it at runtime:

```bash
flow --plugin path/to/my_isa.so  my_test.flow
```

---

## Writing a Script

A `.flow` script says *what* to generate. The engine decides *how*:

```
# Directed: exact instructions in the order you specify
scene boot {
  directed {
    MOV  sp, 0x1000
    ADD  r1, r0, 0
  }
}

# Constrained-random: engine picks instructions and operands
scene load_stress {
  random  32
  tags:   [mem, load]
  exclude: [HALT, NOP]
}

# Compose: loop and mix freely
loop 4 {
  scene load_stress
  random 8  tags: [alu]
}
```

Pass `--seed` for a bit-identical run; omit it for a fresh stream each time.

---

## ISA Adoption Path

Start at the level that fits your architecture and step up only when you need to:

| Level | C++ required? | What it covers | Upgrade when… |
|---|---|---|---|
| **A** | **None** — two YAML files | Full instruction table, register file, instruction tags and mix weights, constrained-random draws, assembly-text output. Sufficient for most standard RISC-style ISAs with independent operands and fixed-width formats. | You need split immediates, PC-relative targets, or binary byte output |
| **B** | **Minimal** — ~one C++ file | Everything in A, plus an encoding step for split immediates, PC-relative offsets, and packed fields. Produces binary-exact byte streams as well as assembly text. | You need to reject instructions based on the combination of operands chosen |
| **C** | **Moderate** — B + validation logic | Everything in B, plus cross-operand rules: register write-protection, pipeline hazard exclusions, alignment constraints, instruction-pair restrictions. | You need exotic multi-word formats, instruction side effects, or grammar extensions |
| **D** | **Full C++** | Complete ISA description in code. Every aspect of the architecture under your control — encoding, side effects, custom grammar constructs. | — |

> **Unsure which level you need?** Most ISAs with fixed-width instructions and independent operands
> are fully covered by Level A. The common signal to move to B is split immediates; to C is a rule
> like "destination register must not be the same as the base register."

The SDK headers and CMake helpers for all four levels are MIT-licensed and
included in every release.

---

## CLI Reference

```
flow [options] <script.flow>

  --plugin <path>    Load a compiled ISA plugin (.so / .dll)
  --isa-dir <path>   Load a YAML ISA from a directory
  --isa <name>       Override the ISA name
  --seed <n>         Fix the RNG seed for reproducible output
  --count <n>        Number of instruction sequences to generate
  --output <file>    Write output to a file  (default: stdout)
  --help             Print this message

Note: --plugin and --isa-dir are mutually exclusive.
```

**`flow_validate`** checks `.flow` and `.rules` files for errors without
running the generator — useful in CI and as a pre-flight check.

```bash
# Linux
./flow_validate-linux-x86_64 my_test.flow

# Windows
.\flow_validate-windows-x86_64.exe my_test.flow
```

Exit 0 = clean; non-zero = errors reported to stderr.

---

## License

| Component | License |
|---|---|
| SDK headers, CMake helpers, docs, templates | **MIT** — use, modify, redistribute freely |
| `flow-*`, `flow_validate-*` (platform binaries) | **Proprietary** — use freely, do not redistribute |

Plugins you build against the SDK headers are entirely your own work.
See `LICENSE`, `LICENSE-BIN`, and `NOTICE` in the archive for the full terms.

---

## Roadmap

| Item | Status |
|---|---|
| TableGen import — generate a YAML plugin from an existing LLVM `.td` file | Planned |

> Have a specific ISA or use case in mind? Open an issue — it helps prioritise.

---

## Resources

| Link | What you will find |
|---|---|
| [Blog series](https://phaneendra-paluri-dev.onrender.com/blogs/teaching-grammar-to-generate-instructions-introducing-flow) | Design motivation, grammar walkthrough, plugin contract, constrained-random generation |
| [SDK docs](sdk/docs/writing_an_isa.md) *(in archive)* | Full plugin authoring guide — all four levels with worked examples |
| [Starter template](sdk/templates/plugin_starter/) *(in archive)* | Copy-and-customise C++ or YAML plugin scaffold |

---

## About

FLOW was designed and built by **Phaneendra Paluri**, an experienced professional
in virtual prototyping — processor and SoC models in C++ and SystemC/TLM-2.

Questions or permission requests: open an issue on this repo.
