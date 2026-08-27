# Golden task: soft-c-ringbuf (C11)

Objective: implement `tests/golden/soft-c-ringbuf/ringbuf.c` per `ringbuf.h`:
- `int rb_init(int *out_ok)` (allocation, 16 slots);
- `int rb_push(int v)` (0 on success, -1 when full);
- `int rb_pop(int *out)` (0 on success, -1 when empty);
- `int rb_size(void)`.

Acceptance: `gcc -std=c11 -Wall -Wextra -Werror [ringbuf.c test.c] && run` passes (test.c).
