package reward

// WithPoints prices a taxonomy grant for a test, the way GrantReward prices a
// watch from its terms. Tests only: production watches are priced by terms.
func WithPoints(req GrantRequest, points int64) GrantRequest {
	def, _ := Definition(req.Action)
	def.Points = points
	req.def = &def
	return req
}

// EffectiveCaps exposes effectiveCaps (12.1.c) to black-box tests. The pure
// 30x-or-floor arithmetic is checked directly here because a live grant
// sequence cannot isolate "this month" from "today" within a single test
// run (every grant a test makes lands on the same calendar day, so the
// daily check always binds first — see caps_test.go's own comment on its
// live boundary test for the one branch that CAN be shown live).
func EffectiveCaps(caps Caps, ageBand AgeBand) (daily, monthly int64) {
	return effectiveCaps(caps, ageBand)
}
