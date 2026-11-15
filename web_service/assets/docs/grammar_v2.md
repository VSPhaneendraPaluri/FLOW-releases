# FLOW v2: Grammar and Semantics Reference

Reference for the FLOW test-script language of the instruction-stream generator.
Companion script: `mycore_all_cases_v2.flow` (uses every construct below).

Notation: W3C EBNF. `X?` optional, `X*` zero or more, `X+` one or more, `"x"` terminal,
`/re/` regular expression. `list<X>` is shorthand for `sep* ( X ( sep+ X )* sep* )?`.

---

## 1. Lexical rules

```
COMMENT   ::= "#" /[^\n]*/                      (ignored)
CONT      ::= "\" NL                            (line continuation, ignored)
NL        ::= "\n"
sep       ::= NL | ";"                          (statement / entry separator)
IDENT     ::= /[A-Za-z_][A-Za-z0-9_]*/
DEC       ::= /[0-9]+(\.[0-9]+)?/               (a "." followed by a digit continues a decimal;
                                                 ".." is always the range token)
NUM       ::= DEC | /0x[0-9A-Fa-f_]+/ | /0b[01_]+/
SNUM      ::= "-"? NUM
PERCENT   ::= DEC "%"
STRING    ::= /"[^"\n]*"/
```

Whitespace other than NL is insignificant. Keywords are lowercase and case-sensitive.
Instruction mnemonics are case-sensitive and defined by the ISA plugin.

### Reserved words
```
isa seed strict use pool bind init intro outro seq scene test
spray run play weave atomic loop fork label goto with and when of until using
taken fall expect report atleast atmost never always class property on within repeat
any zero random undef fill pattern load times
reg addr imm instr mem int
```
`mix` and `rules` are contextual (meaningful only after `report`). The ISA plugin must not
declare any mnemonic, register, operand, or state name that equals a reserved word, and user pool
names must not equal any mnemonic or register name (checked at load time).

---

## 2. Grammar

### 2.1 File and top level
```
file          ::= sep* ( global_item ( sep+ global_item )* sep* )?

global_item   ::= isa_decl | seed_decl | strict_decl | use_decl
                | pool_decl | bind_decl | init_decl | rule
                | intro_decl | outro_decl
                | seq_decl | scene_decl | test_decl

isa_decl      ::= "isa" IDENT
seed_decl     ::= "seed" NUM
strict_decl   ::= "strict"
use_decl      ::= "use" STRING
```

### 2.2 Pools and binding
```
pool_decl     ::= "pool" pool_kind IDENT "{" list<entry> "}"
pool_kind     ::= "reg" | "addr" | "imm" | "instr"

entry         ::= ( weight ":" )? item_group guard?
weight        ::= PERCENT | DEC
item_group    ::= item ( "," item )*                (items share the entry's weight equally)
item          ::= "any"
                | "class" IDENT                      (instr pools only)
                | atom ( ".." atom )?                (range or single value)
atom          ::= SNUM | IDENT                       (IDENT: register, mnemonic, or pool name)
guard         ::= "when" expr

bind_decl     ::= "bind" "{" list<bind_item> "}"
bind_item     ::= bind_target "->" IDENT
bind_target   ::= pool_kind | IDENT "." IDENT        (operand kind, or MNEMONIC.operand)
```

### 2.3 Initial state
```
init_decl     ::= "init" ( "mem" | "reg" ) "{" list<init_item> "}"
init_item     ::= atom ( ".." atom )? "=" init_value
init_value    ::= SNUM
                | "zero" | "undef"
                | "random" ( "(" IDENT ")" )?
                | "fill" "(" SNUM ")"
                | "pattern" "(" IDENT "," NUM ")"
                | "load" "(" STRING ")"
```

### 2.4 Rules
```
rule          ::= quantifier selector amount? scope?
quantifier    ::= "atleast" | "atmost" | "never" | "always"
selector      ::= "class" IDENT
                | "property" IDENT ( "(" arg_list? ")" )? ( "on" IDENT )?
                | IDENT ( operand ( "," operand )* )?   (mnemonic or instruction pattern)
amount        ::= PERCENT | NUM "times"            (share of sprayed instructions, or absolute count)
scope         ::= "within" ( "scene" | "test" ) IDENT
```

### 2.5 Operands
```
operand       ::= SNUM | IDENT | mem_ref | wildcard
mem_ref       ::= "[" addr_term ( ( "+" | "-" ) addr_term )* "]"
addr_term     ::= SNUM | IDENT | wildcard
wildcard      ::= "?" IDENT?                         ("?": bound pool, "?pool": named pool;
                                                      no whitespace between "?" and the name)
```

### 2.6 Reusable units
```
params        ::= "(" ( param ( "," param )* )? ")"
param         ::= IDENT ":" type
type          ::= "int" | "reg" | "addr" | "imm" | "label"

seq_decl      ::= "seq"   IDENT params? "{" list<body_stmt>  "}"
scene_decl    ::= "scene" IDENT params? "{" list<scene_stmt> "}"

intro_decl    ::= "intro" "{" list<body_stmt> "}"
outro_decl    ::= "outro" "{" list<body_stmt> "}"
```

### 2.7 Tests
```
test_decl     ::= "test" IDENT test_opt* "{" list<test_stmt> "}"
test_opt      ::= "seed" NUM | "repeat" NUM
```

### 2.8 Statements
```
body_stmt     ::= instr_stmt | spray_stmt | run_stmt | play_stmt | weave_stmt
                | atomic_stmt | loop_stmt | fork_stmt | label_stmt | goto_stmt
                | with_stmt | expect_stmt | report_stmt
block_stmt    ::= body_stmt | rule                   (allowed inside "with")
scene_stmt    ::= block_stmt | intro_decl | outro_decl
test_stmt     ::= scene_stmt | init_decl

instr_stmt    ::= IDENT ( operand ( "," operand )* )?

spray_stmt    ::= "spray" count "of" IDENT           (IDENT: instr pool or single mnemonic)
count         ::= bound | bound ".." bound | "until" expr
bound         ::= NUM | IDENT                        (IDENT: int parameter)

run_stmt      ::= "run" IDENT call_args?
call_args     ::= "(" ( arg ( "," arg )* )? ")"
arg           ::= SNUM | IDENT | "class" IDENT

play_stmt     ::= "play" bound? "{" list<play_entry> "}"
play_entry    ::= ( weight ":" )? IDENT call_args?

weave_stmt    ::= "weave"  "{" list<body_stmt> "}"
atomic_stmt   ::= "atomic" "{" list<body_stmt> "}"
loop_stmt     ::= "loop" bound ( ".." bound )? "{" list<body_stmt> "}"

fork_stmt     ::= "fork" ( "using" IDENT )? "{" list<fork_arm> "}"
fork_arm      ::= ( weight ":" )? ( "taken" | "fall" ) "{" list<body_stmt> "}"

label_stmt    ::= "label" IDENT
goto_stmt     ::= "goto"  IDENT

with_stmt     ::= "with" override ( "and" override )* "{" list<block_stmt> "}"
override      ::= IDENT "=" entry                    (entry may name a pool of the same kind)

expect_stmt   ::= "expect" expr
report_stmt   ::= "report" ( "mix" | "rules" )
```

### 2.9 Expressions (guards, `until`, `expect`)
```
expr          ::= and_expr ( "||" and_expr )*
and_expr      ::= not_expr ( "&&" not_expr )*
not_expr      ::= "!" not_expr | cmp_expr
cmp_expr      ::= arith ( cmp_op arith )?
cmp_op        ::= "==" | "!=" | "<" | "<=" | ">" | ">="
arith         ::= primary ( arith_op primary )*      (one precedence level, left to right;
                                                      use parentheses)
arith_op      ::= "+" | "-" | "&" | "|" | "^" | "<<" | ">>"
primary       ::= SNUM
                | mem_ref
                | state_ref
                | "(" expr ")"
state_ref     ::= IDENT ( "." IDENT )* ( "(" arg_list? ")" )?
arg_list      ::= arg ( "," arg )*
```
`state_ref` covers registers (`r2`), parameters (`n`), architectural-model queries registered by
the ISA plugin (`sbuf.full`, `rob.occupancy`), and generator counters (`count(ST)`,
`count(class branch)`, counted over sprayed instructions in the current scope).

---

## 3. Placement table

| Construct | global | seq | scene | test | nested block |
|---|:-:|:-:|:-:|:-:|:-:|
| `isa` `seed` `strict` `use` `pool` `bind` | yes | | | | |
| `init` | yes | | | yes | |
| `rule` | yes | | yes | yes | in `with` only |
| `intro` `outro` | yes | | yes | yes | |
| `seq` `scene` `test` | yes | | | | |
| generating and control statements | | yes | yes | yes | yes |

A "nested block" is the body of `loop`, `fork` arm, `weave`, `atomic`, `with`, `intro`, `outro`.

---

## 4. Semantics

### 4.1 Pools and weights
- Within one pool, all weights are percentages or all are relative numbers; mixing is an error.
- Percentages must sum to exactly 100. Relative weights are normalized. A missing weight is 1.
- A comma group shares one weight equally (`30%: r16, r22` gives 15% each).
- A `when` guard is evaluated against the architectural model at draw time. A false entry is removed
  and the remaining weights renormalize. If no entry is eligible, generation stops with an error
  naming the pool and the guards.
- A pool may reference another pool of the same kind (nesting). Cycles are an error.
- `bind` maps an operand kind to its default pool; `MNEMONIC.operand -> pool` overrides one operand.
  Operand names come from the ISA plugin.

### 4.2 Wildcards
`?` in a directed instruction draws that operand from the pool bound to its kind. `?pool` draws it
from the named pool. Explicit operands are never changed.

### 4.3 Rules
- Rule form is `quantifier selector [amount] [scope]`. `atleast`/`atmost` require an amount;
  `never`/`always` forbid one. A percent amount (`20%`) is a share of sprayed instructions in the
  scope; a count amount is written `N times` (`atmost class branch 40 times`). In a selector, a number
  immediately followed by `times` is the amount, never an operand of an instruction pattern.
- **Percent and count rules measure and steer sprayed instructions only.** Directed instructions and
  framework-generated control code (loop counters, fork branches, `goto`) neither count nor are
  constrained. A rule whose scope contains zero sprayed instructions is vacuous and reported as such.
- **`never` and `always` apply to everything**, directed code included. A statically detectable
  violation is a load error; otherwise it is a generation error.
- Rule scope is the block it is written in. Top-level rules cover every test. `within scene X` or
  `within test X` narrows a top-level rule. Rules in nested scopes all hold (intersection).
- Unsatisfiable combinations (for example `atleast ST 90%` with `atmost ST 10%`) are load errors.
- A satisfiable rule that a run does not meet is a warning with the achieved value, or an error
  under `strict`.
- Steering: rules bias later draws and may exclude entries; they never alter instructions already
  emitted.

### 4.4 Generation statements
- `spray N of P`: N independent draws from `P`, each filling its operands from bound pools.
  `N..M` picks a count uniformly from the range; `until expr` draws until `expr` holds, with a
  default safety cap that raises an error if hit.
- `run X(args)`: expand a seq or scene in place. Arguments are type-checked against `params`.
  Scene/seq recursion (direct or indirect) is a load error.
- `play [N] { w: X ... }`: N times (default 1), pick one entry by weight and `run` it.
- `loop N { }` / `loop A..B { }`: emits one body, generated once, inside a real counted loop;
  the counter register and control instructions are generated automatically.
- `fork [using P] { w: taken {..}  w: fall {..} }`: emits a branch instruction (from `P`, default the
  ISA's branch class), builds operand state so the chosen arm's outcome is guaranteed, then emits the
  chosen arm. Exactly one `taken` and one `fall` arm; omitted weights default to 50/50.
- `label` / `goto`: explicit control flow. Labels are test-global when written in a test, and
  uniquified per instantiation when written in a scene or seq.
- `with P = entry [and Q = entry] { }`: overrides the pool for the block. The block's statements
  remain visible to `weave` as if the `with` were absent (transparent).
- `expect expr`: evaluated against the generator's architectural model at that point; a mismatch is
  a generation error. Backends may also emit it as a self-check or simulator assertion.

### 4.5 `weave`
Each child statement of `weave` is a stream. Streams are flattened to units and then interleaved
at random; order inside each stream is preserved.

- Splittable units: each instruction drawn by `spray`, and each plain instruction statement.
- Indivisible units: `run`, `play`, `loop`, `fork`, `atomic`.
- `with` is transparent: its contents keep their own unit type.

Units never expose partial scene or loop state, so register setup inside a scene cannot be clobbered
by interleaved draws. Memory shared between units is not protected; keep sprays away from it with a
`with` override (see `full_mix` in the script).

### 4.6 Scopes and order
Execution order for one test, outermost first:

```
init (global, then test overrides)  ->  global intro  ->  test intro
  ->  body (scene intro -> scene body -> scene outro on each run)
  ->  test outro  ->  global outro
```
- A test-level `init` overrides the global `init` for overlapping addresses and registers.
- Within one `init mem`, overlapping ranges are allowed; the later line wins, with a warning
  (error under `strict`).
- `init` may cover addresses outside every pool.

### 4.7 Seeds and repeats
- `seed N` at top level sets the base seed. `test T seed N` overrides it for that test.
- `test T repeat K` produces K tests `T_0 .. T_{K-1}`; seed *i* is derived deterministically from the
  test's seed and *i*. The derivation is fixed by the framework version and recorded in the report.
- The same file, ISA plugin, and seed always produce an identical stream.

### 4.8 `init` modes
`zero`; constant; `fill(v)`; `pattern(inc|dec|walking1|checker, width)`; `random` (seeded);
`random(pool)` (drawn from a pool); `undef` (reads are errors under `strict`, warnings otherwise);
`load("file")` (binary blob, path relative to the script).

### 4.9 `strict`
Promotes all warnings to errors: unmet rules, overlapping init ranges, reads of `undef` memory,
unused pools.

### 4.10 `report`
`report mix` prints the final instruction mix for the test. `report rules` prints each rule with its
required and achieved value and whether it was vacuous.

### 4.11 `use`
`use "path"` textually includes pools, binds, seqs, and scenes from another file before this one is
processed. Tests, `isa`, `seed`, and `strict` in an included file are an error. Duplicate names are an
error.

---

## 5. Static checks (load time)
1. Reserved-word and name collisions (section 1).
2. Pool weights well-formed; pool kinds consistent with their items and with `bind`.
3. Every referenced pool, seq, scene, label, parameter, and mnemonic exists; `run`/`play` arguments
   match parameter types.
4. No recursion among scenes and seqs; no cycles among nested pools.
5. Placement table (section 3) respected.
6. Rule form (amount presence) and statically contradictory rules.
7. Operand shapes legal for the ISA plugin's addressing modes.
8. `fork` has exactly one `taken` and one `fall` arm.

## 6. Changes from v1 draft
| Topic | v1 | v2 |
|---|---|---|
| Pool declaration | `pool gpr : reg {}` | `pool reg gpr {}` |
| Colon | kind, weight, and init mode | weight only; init uses `=` |
| Weights | percent only | percent or relative, validated |
| Rules | mixed shapes | `quantifier selector [amount] [scope]` |
| Memory operands | `0x1040` or `[r1]` | always bracketed: `[0x1040]`, `[r1 + 4]` |
| Memory in `expect` | `mem[a]` | `[a]` |
| Scene params | untyped | typed (`int reg addr imm label`) |
| Pool override | block and trailing `with` | block `with` only; `and` joins overrides |
| New | | `use`, `strict`, `seed`/`repeat` per test, `report`, `atomic`, wildcards `?`, `play N`, `loop A..B`, `count()`, global `intro`/`outro` |
