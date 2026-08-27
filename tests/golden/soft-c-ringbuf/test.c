#include "ringbuf.h"
#include <assert.h>
#include <stdio.h>

int main(void) {
  int ok = 0, v = 0, i;
  assert(rb_init(&ok) == 0 && ok);
  for (i = 0; i < 16; i++) assert(rb_push(i) == 0);
  assert(rb_push(99) == -1);
  for (i = 0; i < 16; i++) { assert(rb_pop(&v) == 0); assert(v == i); }
  assert(rb_pop(&v) == -1);
  assert(rb_size() == 0);
  for (i = 0; i < 20; i++) assert(rb_push(i) == 0);
  for (i = 0; i < 4; i++) assert(rb_pop(&v) == 0);
  assert(rb_size() == 16);
  printf("soft-c-ringbuf OK\n");
  return 0;
}
