.PHONY: test test-live check package
test:
	pnpm test
test-live:
	pnpm test:live
check:
	pnpm check
package: check test
	pnpm package
