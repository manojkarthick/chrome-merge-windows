.PHONY: test test-live check package bump
test:
	pnpm test
test-live:
	pnpm test:live
check:
	pnpm check
package: check test
	pnpm package
bump:
	pnpm bump $(VERSION)
