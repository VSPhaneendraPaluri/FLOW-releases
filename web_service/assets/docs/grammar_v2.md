# FLOW Grammar Reference

A keyword-by-keyword guide to writing `.flow` and `.rules` scripts.
Each entry tells you what the keyword does, when you'd reach for it, and shows a minimal working example.

---

## `.rules` file keywords

The `.rules` file is architect-owned. It defines the legal envelope — what pools exist, what is forbidden, what is required. Test files import it with `use`.

---

### `isa`

Names the ISA plugin this file targets. Every `.rules` file needs exactly one.

```
isa core_a
```

> You have a custom core. This tells FLOW which plugin to load — giving it the instruction table, register file, and addressing modes.

---

### `pool`

Declares a named set of values to draw from. Syntax: `pool <name> : <kind> { entries }`. Four kinds: `reg`, `addr`, `imm`, `instr`. Entries can carry `@weight` to bias random draws.

```
pool gpr : reg {
    r4..r31
}

pool hot_gpr : reg {
    r4, r5, r6, r7    @4    # argument registers — 4× more likely
    r8, r9, r10, r11  @2
    r12, r13          @1
}

pool alu_rr : instr {
    ADD, SUB, AND, OR, XOR  @2
    SHL, SHR, SAR           @1
}
```

> You have 32 registers but `r0`–`r3` are reserved. Declare `pool gpr : reg { r4..r31 }` and every random draw stays out of the reserved range automatically — no manual filtering needed.

**Notes:**
- All weights in a pool must be relative (`@N`) or all percentages. Mixing is an error.
- A pool may reference another pool of the same kind (nesting). Cycles are an error.

---

### `reg` / `addr` / `imm` / `instr`

Pool kind annotations — restrict what a pool may contain and how it is used in draws.

```
pool src_regs : reg  { r4..r15 }
pool base_addr : addr { 0x8000..0x83FF }
pool small_imm : imm { -16..15 }
pool loads : instr { LDQ, LDW, LDH, LDB }
```

---

### `reserve`

Removes registers from all random draws permanently. FLOW uses a reserved register as a loop counter; reserving arch-defined specials prevents the generated stream from corrupting the stack pointer or return address.

```
reserve r0, r1, r2, r3
```

> `r0` is hardwired-zero, `r1` is the return address, `r2` is the stack pointer. Reserve them once and no random draw ever touches them — in any test.

---

### `forbid`

Prohibits a specific instruction pattern. The `as` clause names the rule for use with `relax` and `override`. The optional `lock` makes it unbreakable — no test may relax it.

```
forbid IDIV <gpr>, <gpr>, r0  as no_idiv_by_zero
forbid SHL <gpr>, <gpr>, <shamt> when shamt >= 64  as no_overshift_l  lock
```

> Division by zero is undefined behaviour on your core. `forbid IDIV … r0` makes it impossible for a random draw to generate that pattern. `lock` on the shift rule makes it unbreakable — not even a test with `relax` can undo it.

---

### `require`

Mandates a condition on a generated instruction. `for <pool>` names the subject; `when instr in <pool>` guards which instructions the rule applies to.

```
require aligned(8) for <addr_gpr>  as load_align_q   when instr in ldq_only
require aligned(4) for <addr_gpr>  as load_align_w   when instr in ldw_only
```

> Your memory model requires quad-word loads to be 8-byte aligned. `require aligned(8)` enforces this at generation time — the engine steers address draws away from misaligned values, so the simulation never sees one.

---

### `when`

A guard that makes a `forbid` or `require` conditional. Evaluated at draw time against the generated values.

```
forbid SHL <gpr>, <gpr>, <shamt>  when shamt >= 64  as no_overshift  lock
require aligned(8) for <addr_gpr> when instr in ldq_only
```

---

### `as`

Names a rule so it can be referenced later with `relax`, `override`, or `group`.

```
forbid IDIV <gpr>, <gpr>, r0  as no_idiv_by_zero
```

---

### `lock`

Makes a `forbid` or `require` rule unbreakable. No `relax` or `override` in any test can loosen it.

```
forbid SHL <gpr>, <gpr>, <shamt>  when shamt >= 64  as no_overshift  lock
```

> Safety-critical constraints — unpredictable behaviour, hardware errata — go behind `lock`. The test writer doesn't even get the option of relaxing them.

---

### `group`

Bundles named rules so a test can relax or override the whole family in one statement.

```
group div_by_zero {
    no_idiv_by_zero
    no_udiv_by_zero
    no_imod_by_zero
    no_umod_by_zero
}
```

> Instead of four `relax` lines to enable division-by-zero tests, the test writer writes one: `relax div_by_zero`. Groups keep test files concise and ensure the whole family moves together.

---

### `in`

Pool-membership condition used in `when` guards.

```
require aligned(8) for <addr_gpr>  when instr in ldq_only
```

---

### `for`

Introduces the subject of a `require` rule — which operand the condition is checked against.

```
require aligned(4) for <addr_gpr>  as load_align_w  when instr in ldw_only
```

---

## `.flow` file keywords

The `.flow` file is test-writer-owned. It describes what scenarios to run and in what proportions. It imports the `.rules` file (and any shared `common.flow`) with `use`.

---

### `use`

Imports pools, scenes, constants, and rules from another `.flow` or `.rules` file. Transitive — a file that imports `common.flow` automatically gets everything `common.flow` itself imported.

```
use "arch/core.rules"
use "arch/common.flow"   # gets core.rules transitively
```

> You maintain a shared `common.flow` with standard burst scenes. All your test files `use` it and get the full library — including the architect's rules — in one line.

---

### `seed`

Pins the random seed. Same seed + same script = identical output every time. Can appear at file level (applies to all tests) or on a single test.

```
seed 0xC0FFEE_0001

test full_scenario(seed = 0xFEED_FACE) { ... }
```

> You found a simulation failure. Pin the seed and the exact stream regenerates on every run — bisect the failure, verify the fix, check in the seed alongside the test.

---

### `strict`

Promotes all warnings to hard errors: unmet mix targets, overlapping init ranges, reads from uninitialised memory, unused pools.

```
strict
```

> You're generating a nightly regression suite. Without `strict`, a mix target `instr_load >= 30%` that only achieves 12% passes silently. With `strict`, the run fails and CI catches it.

---

### `const`

Declares a compile-time integer constant. Usable anywhere a number is expected.

```
const REGION_BASE = 0x0000_8000
const BURST       = 16
```

> Name your magic numbers once at the top. `run load_burst(BURST)` is clearer than `run load_burst(16)`, and changing the burst size is one edit instead of many.

---

### `defaults`

Sets the default pool for each operand kind (and per-mnemonic operands). Equivalent to a file-level binding — all `crand` draws use these unless overridden with `with`.

```
defaults {
    reg              = hot_gpr
    addr             = addr_gpr
    instr_load.addr  = addr_gpr
    instr_store.addr = addr_gpr
}
```

> You have three pools. Without `defaults` you'd name the pool on every draw. With `defaults`, all subsequent `crand` calls use the right pools automatically.

---

### `mix`

Declares instruction-mix targets for the file. The engine steers random draws to satisfy them. Reported at the end of each test.

```
mix {
    instr_load  >= 30%
    instr_store >= 20%
    alu_rr      >= 15%
}
```

> You're verifying the memory subsystem. `instr_load >= 30%` ensures at least 30% of random draws are load instructions — without hard-coding individual counts in every test.

---

### `before`
### `after`

File-level: `before each test { }` and `after each test { }` run around every test in the file.
Test-local: `before { }` and `after { }` inside a test run only for that test.

```
# File-level — applies to every test
before each test {
    init memory { 0x8000..0x83FF = fill(0xFF) }
}
after each test {
    report mix
}

# Local — applies to this test only
test store_then_reload {
    before { init memory { 0x8000..0x83FF = zero } }
    run store_burst(8)
    run load_burst(8)
    after  { check [0x8000]:8 == 0 }
}
```

> File-level hooks avoid repeating the same init and report in every test block. Local hooks let one test deviate — zero out memory before and assert after — without affecting the rest.

---

### `init`

Sets memory or register state before a test runs. Can appear at file level (via `before each test`) or inside a test block.

```
init memory {
    0x8000..0x83FF = fill(0xFF)
    0x9000..0x9FFF = zero
    0xA000..0xA0FF = counting(1)
}
```

Init value forms:

| Form | Meaning |
|---|---|
| `= N` | Constant value |
| `zero` | All bytes set to 0 |
| `fill(N)` | Fill every unit with N |
| `counting(N)` | Incrementing values starting from N |
| `random` | Seeded random values |

> You're writing a load/store test. Fill the data section with a known pattern before the test runs and check the memory contents after. The `before`/`after` hooks keep this bookkeeping out of the test body.

---

### `scene`

A reusable, named, parameterised fragment of test logic. Scenes take typed parameters (`int`, `reg`, `addr`, `imm`). Called with `run`.

```
scene load_burst(n: int) {
    with addr = addr_gpr {
        crand n instr_load
    }
}

scene load_store_pair(n: int) {
    interleave {
        { crand n instr_load  }
        { crand n instr_store }
    }
}
```

> You need a load burst in a dozen tests. Write `scene load_burst` once and `run load_burst(BURST)` everywhere. Change the burst logic in one place.

---

### `test`

The top-level unit of generation. Each `test` block produces one independent instruction stream.

```
test smoke_alu {
    run mixed_alu(20)
    check r4 == r5
}

test load_burst_basic {
    init memory { 0x8000..0x83FF = fill(0xAB) }
    run load_burst(BURST)
}
```

---

### `crand`

The core random-generation statement. Draws N instructions from a named pool, filling operands from defaults (or the active `with` override). The count can be a literal, a `const`, or an `until … max` expression.

```
crand 20 alu_rr
crand BURST instr_load
crand instr_load until instr in ldq_only max 500
```

> `crand BURST instr_load` draws 16 load instructions with operands filled from the default pools. `crand … until instr in ldq_only max 500` draws loads until a quad-word access appears — no need to guess a count.

**Note:** This is the FLOW equivalent of what might be called `spray` in other ISGs. In FLOW the keyword is `crand` (constrained-random draw).

---

### `until`
### `max`

An alternative count for `crand` — draws continue until a condition holds. `max` sets a safety cap; the run errors if it is hit without the condition becoming true.

```
crand instr_load until instr in ldq_only max 500
```

> You want to exercise the quad-word load path. Draw load instructions until a `LDQ` appears. Without `max`, a misconfigured pool could loop forever.

---

### `run`

Calls a named scene, expanding it inline at this point.

```
run load_burst(BURST)
run load_store_pair(8)
run mixed_alu(10)
```

---

### `repeat`

Executes a block N times, each time as an **independent** random draw. Each iteration gets a fresh seed derived from the test seed. This is different from `loop` — `repeat` does not emit counted-loop control code.

```
repeat 4 {
    run load_burst(BURST / 2)
}
```

> You want 4 statistically varied runs of the same scene in one test. `repeat 4` gives you 4 independent draws. `loop 4` would give you one counted loop in the output stream — use `loop` when you want the simulator to see real loop execution.

---

### `loop`

Emits a counted loop in the output stream, complete with counter load, decrement, and branch generated by the engine. FLOW uses a reserved register as the counter. The body is generated once, not N times.

```
loop 8 {
    run alu_burst(4)
    run load_burst(4)
}
```

> You're testing branch-predictor loop detection. `loop 8` emits a real counted loop — the predictor sees a real loop pattern. `repeat 8` would emit 8 flat copies with no loop structure at all.

---

### `choose`

Randomly picks one arm per iteration according to weights. Two forms: `choose one { }` (pick once) and `choose N times { }` (pick N times independently).

```
choose 32 times {
    run load_burst(4)   @3
    run store_burst(4)  @2
    run mixed_alu(8)    @1
}

choose one {
    run likely_taken_branch
    run fifty_fifty_branch
}
```

> You want 32 randomly-ordered phase executions with loads being most common. `choose 32 times` picks one arm per iteration weighted 3:2:1 — no need to calculate exact counts.

---

### `one`
### `times`

Variants of `choose`. `one` picks a single arm; `times` repeats the selection N times.

```
choose one   { ... }
choose 8 times { ... }
```

---

### `interleave`

Merges multiple child blocks into one stream, preserving per-block internal order. Each child block's instructions are split into units and interleaved randomly.

```
interleave {
    { crand n instr_load  }
    { crand n instr_store }
}

interleave {
    { run load_store_pair(8) }
    { run likely_taken_branch }
    atomic {
        STQ r4, [0x8000]
        LDQ r5, [0x8000]
        check r5 == r4
    }
}
```

> You want loads and stores interleaved to stress the memory pipeline — not all loads followed by all stores. `interleave` randomly mixes draws from both blocks while keeping each block's internal ordering intact.

**Note:** `run`, `loop`, `branch`, and `atomic` are indivisible inside `interleave`. Individual `crand` draws are split.

---

### `atomic`

Marks a block as an indivisible unit inside `interleave`. The interleaver will not insert instructions between statements in an `atomic` block.

```
interleave {
    { run load_store_pair(8) }
    atomic {
        STQ r4, [0x8000]
        LDQ r5, [0x8000]    # must immediately follow the STQ
        check r5 == r4
    }
}
```

> The `LDQ` must immediately follow the `STQ` to test store-to-load forwarding. `atomic` prevents the interleaver from inserting anything between them.

---

### `branch`

Emits a branch instruction followed by weighted outcome arms. The engine sets up operand state so the chosen arm's outcome is architecturally guaranteed.

```
scene likely_taken_branch {
    branch {
        taken     { run alu_burst(3) }  @4
        not_taken { run alu_burst(3) }  @1
    }
}
```

> You need 80% of branches taken. Each `branch` emits a real branch with correctly set-up condition state — the simulator follows the intended path. You get a controlled, reproducible taken/not-taken ratio.

---

### `taken`
### `not_taken`

The two arms of a `branch` block. Weights default to equal if unspecified.

```
branch {
    taken     { run hot_path }   @4
    not_taken { run cold_path }  @1
}
```

---

### `with`

Overrides one or more pool bindings for the duration of a block. Useful for narrowing draws to a specific address range or register subset.

```
with addr = addr_gpr {
    crand BURST instr_load
    crand BURST instr_store
}
```

> One section of your test must stay in a specific address range to avoid hazards with an earlier section. `with addr = addr_gpr` restricts address draws to that pool for just that block, leaving the global `defaults` unchanged everywhere else.

---

### `check`

Asserts a value against the architectural model at this point. Can check registers, memory, or computed expressions.

```
check r4 == r5
check r5 == r4
check [0x8000]:8 == 0xFFFF_FFFF_FFFF_FFFF
```

> After a store-then-load pair you assert the loaded value equals what was stored. `check r5 == r4` fails at generation time if the model disagrees — catching bugs early without running a simulation.

---

### `relax`

Disables a named rule or rule group for this test only. The rule remains active in all other tests.

```
relax div_by_zero
relax alignment_rules
```

> You're specifically testing divide-by-zero behaviour. `relax div_by_zero` disables all four divide-by-zero `forbid` rules for this test so FLOW can generate those patterns. All other tests are unaffected.

**Note:** `relax` cannot loosen a `lock`ed rule.

---

### `override`

Replaces the body of a named rule for this test only. More surgical than `relax` — the rule still exists but with different conditions.

```
override load_align_q {
    require in_range(REGION_BASE, REGION_END) for <addr_gpr>
}
```

> Instead of removing the quad-word alignment rule, you replace it with a range check — load addresses must stay within the test's region, but alignment is no longer enforced. The original rule is restored for all other tests.

---

### `expect`
### `fault`

Declares that the enclosed instructions should raise a specific fault. Used with a reference model to test fault-handling paths.

```
relax alignment_rules
expect fault misaligned_load {
    LDQ r4, [0x0001]    # odd address — will misalign
}
```

> You need to verify your misaligned-access fault handler. `expect fault misaligned_load` documents the intent and lets tooling verify the fault was actually raised.

---

### `label`
### `goto`

Defines a jump target (`label`) and an unconditional branch to it (`goto`). Labels are test-global when written directly in a test; uniquified per instantiation when written in a scene.

```
test label_goto_forward {
    crand 4 alu_rr
    goto skip_stores
    run store_burst(8)   # never reached
    label skip_stores
    run load_burst(8)
}
```

> You need an explicit forward jump to skip a block of stores — for a control-flow coverage test. `label`/`goto` give you direct control flow without the loop-counter machinery that `loop` adds.

---

### `report`

Prints a summary at the end of a test or in the `after` hook. Two forms:

```
report mix    # instruction mix — count and percentage per pool/class
report rules  # each rule, its target, achieved value, and pass/fail
```

> After a relaxed-division test you `report rules` to see which rules were vacuous (zero sprayed instructions in scope) versus actually evaluated. `report mix` shows what percentage of each instruction class was drawn — useful for tuning pool weights.

---

### `&&` / `||` / `!`

Boolean operators for guard expressions. FLOW uses symbolic operators, not the
word forms `and` / `or` / `not` — those are not recognized by the parser.

```
forbid SHL <gpr>, <gpr>, <shamt>  when shamt >= 64 && shamt < 128
when !sbuf.full || rob.occupancy < 4
```
