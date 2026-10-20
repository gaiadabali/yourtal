-- F116 (group 1.6.g, 1.6.h): a viewer can declare "my area" in Me, and a
-- campaign's target districts are postcodes from the fixed area list.
--
-- A declared area is optional personal data, not geolocation: the viewer
-- picks a suburb from a list and the postcode is stored, nothing is read
-- from the device. One row per viewer who set one; no row means "no area".
-- The API refuses it for a teen account and rejects a postcode that is not
-- on the viewer's own region's list.
CREATE TABLE me.viewer_area (
  user_id    text        PRIMARY KEY,
  region     text        NOT NULL CHECK (region IN ('AU', 'ID')),
  postcode   text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viewer_area_postcode_shape CHECK (
    (region = 'AU' AND postcode ~ '^[0-9]{4}$') OR (region = 'ID' AND postcode ~ '^[0-9]{5}$')
  )
);

-- DELETE: the viewer can clear it, and account deletion erases it.
GRANT SELECT, INSERT, UPDATE, DELETE ON me.viewer_area TO yourtal_app;

-- The region wall every region table carries (13.5.e).
ALTER TABLE me.viewer_area ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON me.viewer_area
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

-- campaign.campaigns.target_districts used to hold free-text names (14.2).
-- It now holds postcodes. Only staging and demo data ever had any, and no
-- seeded campaign targets a district, so this keeps what already reads as a
-- postcode of the campaign's own region (four digits for AU, five for ID) and
-- drops every other value: a name like "Bondi" cannot be mapped to one
-- postcode without guessing, and a dropped value only widens that campaign
-- back to "shown everywhere", which the founder can narrow again in Studio.
UPDATE campaign.campaigns c
   SET target_districts = COALESCE(
     (SELECT jsonb_agg(DISTINCT kept.value)
        FROM jsonb_array_elements_text(c.target_districts) AS kept(value)
       WHERE kept.value ~ CASE WHEN c.region = 'AU' THEN '^[0-9]{4}$' ELSE '^[0-9]{5}$' END),
     '[]'::jsonb)
 WHERE jsonb_array_length(c.target_districts) > 0;

ALTER TABLE campaign.campaigns
  ADD CONSTRAINT campaigns_target_districts_postcodes CHECK (
    NOT jsonb_path_exists(target_districts, '$[*] ? (!(@.type() == "string") || !(@ like_regex "^[0-9]{4,5}$"))')
  );
