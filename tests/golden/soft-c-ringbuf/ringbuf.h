#ifndef RINGBUF_H
#define RINGBUF_H
int rb_init(int *out_ok);
int rb_push(int v);
int rb_pop(int *out);
int rb_size(void);
#endif
