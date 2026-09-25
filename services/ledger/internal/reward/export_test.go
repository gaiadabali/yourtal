package reward

// WithPoints prices a taxonomy grant for a test, the way GrantReward prices a
// watch from its terms. Tests only: production watches are priced by terms.
func WithPoints(req GrantRequest, points int64) GrantRequest {
	def, _ := Definition(req.Action)
	def.Points = points
	req.def = &def
	return req
}
