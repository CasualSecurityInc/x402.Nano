# x402.Nano Documentation Makefile

D2_SRC = $(wildcard docs/diagrams/*.d2)
D2_OUT = $(patsubst docs/diagrams/%.d2,docs/img/%.svg,$(D2_SRC))

.PHONY: all clean

all: $(D2_OUT)

docs/img/%.svg: docs/diagrams/%.d2
	@mkdir -p docs/img
	@echo "Compiling $< -> $@..."
	d2 --theme=0 $< $@

clean:
	rm -rf docs/img/*.svg