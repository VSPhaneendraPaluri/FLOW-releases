# FLOW — Instruction Stream Generator

> **Generate legal, varied CPU instruction streams from a simple script.**  
> No ISA hard-coding. No boilerplate. Reproducible by seed.

FLOW is a ready-to-run tool for CPU verification engineers and SoC architects
who need high-quality instruction sequences — directed, constrained-random, or
mixed — without writing a custom generator for every new architecture.

---

## Who is FLOW for?

| You are… | FLOW lets you… |
|---|---|
| **CPU / SoC verification engineer** | Generate targeted instruction streams for your DUT without maintaining a bespoke generator |
| **Performance architect** | Produce realistic workload mixes to stress your micro-architecture |
| **ISA designer** | Validate your instruction set definition early — before RTL is complete |
| **Simulation engineer** | Feed instruction sequences into ISSs, cycle-accurate models, or emulators |

---

## What is in a release?

Each release archive contains everything you need to start generating:

```
flow-sdk-<version>-<platform>.zip
├── bin/
│   ├── flow-linux-x86_64                Linux x86-64 generator CLI
│   ├── flow-windows-x86_64.exe          Windows x86-64 generator CLI
│   ├── flow_validate-linux-x86_64       Linux x86-64 grammar validator
│   └── flow_validate-windows-x86_64.exe Windows x86-64 grammar validator
├── include/flow/isa/     ISA SDK headers (MIT) — build your own ISA plugin
├── cmake/                CMake helpers for plugin projects
├── docs/                 Plugin authoring guide
├── templates/            Starter templates — copy and customise
├── examples/             Worked example (toy ISA, all tiers)
├── LICENSE               MIT license (SDK)
├── LICENSE-BIN           Binary license (platform binaries)
└── NOTICE                Plain-English license summary
```

---

## Download

👉 **[Latest release →](../../releases/latest)**

Both **Windows (x64)** and **Linux (x86-64)** binaries are included in every archive.

---

## Quick Start

### 1 — Run against a YAML ISA definition (zero C++)

The fastest path. Describe your ISA in two YAML files and point FLOW at them:

```
my_isa/
├── instructions.yml
└── registers.yml
```

```bash
flow --isa-dir my_isa/  my_test.flow
```

That is all. FLOW loads your ISA, parses the script, and streams assembly to
stdout (or `--output <file>`).

### 2 — Run against a compiled ISA plugin

For architectures with custom encodings or cross-operand constraints, build a
plugin `.so` / `.dll` from the SDK headers and load it at runtime:

```bash
flow --plugin path/to/my_isa.so  my_test.flow
```

---

## Writing a .flow Script

A `.flow` script expresses *what* to generate — the engine decides *how*:

```
isa riscv32          # name must match the loaded ISA

# Directed: exact sequence you specify
directed:
    ADD  x1, x2, x3
    ADDI x4, x1, 42

# Random: engine picks instructions and operands
random(count=100):
    tags: [alu, load]   # restrict to these instruction categories

# Loop: repeat a block N times
loop(10):
    random(count=20):
        tags: [branch]
```

```bash
flow --isa-dir riscv32/  --seed 42  --count 500  my_test.flow
```

Fix `--seed` for a reproducible run; omit it for a fresh random stream each time.

---

## ISA Adoption Ladder

FLOW meets your ISA where it is. Start at the tier that fits and step up only
when you need to:

| Tier | C++ needed? | What you write | Typical use |
|---|---|---|---|
| **A** | None | `instructions.yml` + `registers.yml` | Fixed-format ISAs, quick experiments, early validation |
| **B** | Minimal | YAML + one `.cpp` override | Split immediates, PC-relative branch targets |
| **C** | Moderate | Tier B + operand-validation hook | Hardwired-zero registers, write-protection rules |
| **D** | Full | C++ `IsaDefinition` subclass | Exotic encodings, maximum control |

Tier A requires no compiler at all — just two YAML files next to your `.flow`
script. Tier D gives you full programmatic control when you need it.

The SDK headers and CMake helpers for all four tiers are MIT-licensed and
included in every release archive.

---

## CLI Reference

```
flow [options] <script.flow>

  --plugin <path>    Load a compiled ISA plugin (.so / .dll)
  --isa-dir <path>   Load a pure-YAML ISA from a directory
  --isa <name>       Override the ISA name
  --seed <n>         Fix the RNG seed for reproducible output
  --count <n>        Number of instruction sequences to generate
  --output <file>    Write output to file  (default: stdout)
  --help             Print this message

Note: --plugin and --isa-dir are mutually exclusive.
```

**`flow_validate`** is included in every release archive alongside `flow`.
It checks `.flow` and `.rules` files for grammar errors without running the
generator — useful in CI or as a pre-flight check before a full run.

Pick the binary for your platform from `bin/` and run it directly (or add
`bin/` to your `PATH` after renaming to taste):

```bash
# Linux
./flow_validate-linux-x86_64 my_test.flow
./flow_validate-linux-x86_64 *.flow        # batch-validate multiple scripts

# Windows (PowerShell / cmd)
.\flow_validate-windows-x86_64.exe my_test.flow
```

Exit code 0 = all clean; non-zero = one or more errors (reported to stderr).

---

## License

| Component | License |
|---|---|
| SDK headers, CMake helpers, docs, templates | **MIT** — use, modify, redistribute freely |
| `flow-*`, `flow_validate-*` (all platform binaries) | **Proprietary** — use freely, do not redistribute |

Plugins you build against the SDK headers are entirely your own work.
See `LICENSE`, `LICENSE-BIN`, and `NOTICE` inside the archive for the full terms.

---

## Resources

| Link | What you will find |
|---|---|
| [Blog series](https://phaneendra-paluri-dev.onrender.com/blogs/teaching-grammar-to-generate-instructions-introducing-flow) | Design motivation, grammar walkthrough, plugin contract, constrained-random generation |
| [SDK docs](sdk/docs/writing_an_isa.md) *(in archive)* | Full plugin authoring guide — all four tiers with examples |
| [Starter template](sdk/templates/yaml_plugin/) *(in archive)* | Copy-and-customise YAML plugin scaffold |

---

## About

FLOW was designed and built by **Phaneendra Paluri**, an experienced professional
in virtual prototyping — processor and SoC models in C++ and SystemC/TLM-2.

Questions or permission requests: pvs.myworks@gmail.com
