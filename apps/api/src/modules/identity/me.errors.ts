/** Discriminated unions on `type` (docs/13b section 4), matching every other module's own `*.errors.ts`. */

export interface ProfileNotFoundError {
  readonly type: "profile_not_found";
}

export type GetMeError = ProfileNotFoundError;
export type UpdateMeError = ProfileNotFoundError;
