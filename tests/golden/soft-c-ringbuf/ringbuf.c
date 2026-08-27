#include "ringbuf.h"
#include <stdlib.h>

#define CAP 16

typedef struct { int data[CAP]; int head; int tail; int count; } rb_t;
static rb_t *g = 0;

int rb_init(int *out_ok) {
  if (g) { *out_ok = 1; return 0; }
  g = (rb_t *)calloc(1, sizeof(rb_t));
  *out_ok = g != 0;
  return *out_ok ? 0 : -1;
}
int rb_push(int v) {
  if (!g || g->count == CAP) return -1;
  g->data[g->tail] = v;
  g->tail = (g->tail + 1) % CAP;
  g->count++;
  return 0;
}
int rb_pop(int *out) {
  if (!g || g->count == 0) return -1;
  *out = g->data[g->head];
  g->head = (g->head + 1) % CAP;
  g->count--;
  return 0;
}
int rb_size(void) { return g ? g->count : -1; }
