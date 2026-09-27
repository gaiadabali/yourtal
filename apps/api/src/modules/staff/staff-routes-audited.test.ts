import "reflect-metadata";
import { METHOD_METADATA, MODULE_METADATA } from "@nestjs/common/constants";
import { INTERNAL_ROLES } from "@yourtal/authz/roles";
import { staffRoleSchema } from "@yourtal/contracts/staff/session";
import { describe, expect, it } from "vitest";
import { STAFF_ACTION_METADATA, STAFF_UNAUDITED_METADATA } from "./staff-action.decorator";
import { StaffModule } from "./staff.module";

/** TASKS.md 9.1.a: "every action is audited" is a build failure, not a habit. */
describe("every staff console route is audited", () => {
  const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StaffModule) ??
    []) as (new (...args: never[]) => unknown)[];

  it("has controllers to check", () => {
    expect(controllers.length).toBeGreaterThan(0);
  });

  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (
        typeof handler !== "function" ||
        Reflect.getMetadata(METHOD_METADATA, handler) === undefined
      ) {
        continue;
      }
      it(`${controller.name}.${name} carries @StaffAction or @StaffUnaudited`, () => {
        const action: unknown = Reflect.getMetadata(STAFF_ACTION_METADATA, handler);
        const unaudited: unknown = Reflect.getMetadata(STAFF_UNAUDITED_METADATA, handler);
        expect(action !== undefined || unaudited !== undefined).toBe(true);
      });
    }
  }
});

describe("the staff role contract", () => {
  it("matches @yourtal/authz's INTERNAL_ROLES", () => {
    expect([...staffRoleSchema.options].sort()).toEqual([...INTERNAL_ROLES].sort());
  });
});
