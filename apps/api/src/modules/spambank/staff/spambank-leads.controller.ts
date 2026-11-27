import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  spambankLeadQuerySchema,
  spambankLeadUpdateSchema,
  type SpambankLead,
  type SpambankLeadPage,
} from "@yourtal/contracts/spambank/staff";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../../shared/authz/async-principal-resolver";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { StaffAction, setStaffAuditContext } from "../../staff/staff-action.decorator";
import { SpambankDb } from "../spambank-db";
import { leadsToCsv } from "./leads.csv";
import { InvalidCursorError, exportLeads, listLeads, updateLead } from "./leads.store";

class LeadQueryDto extends createZodDto(spambankLeadQuerySchema) {}
class LeadUpdateDto extends createZodDto(spambankLeadUpdateSchema) {}

/**
 * BUILD.md 4.7 / 5.4: GOD's sales list of brands that mailed Spambank users. The region is always the
 * signed-in staff member's own (from the session, never a parameter), so AU and ID lists never mix.
 * `support` reads; only `ops` edits the status and the note (policies/resource_policies/spambank_lead.yaml).
 */
@Controller("api/staff/spambank/leads")
export class SpambankLeadsController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(SpambankDb) private readonly db: SpambankDb,
  ) {}

  @StaffAction("spambank.leads.list")
  @Authorize({ kind: "spambank_lead", action: "view", idFrom: () => "self" })
  @NotValueMoving("A read.")
  @Get()
  async list(
    @Query() query: LeadQueryDto,
    @Req() request: FastifyRequest,
  ): Promise<SpambankLeadPage> {
    const { attr } = await this.principals.resolve(request);
    setStaffAuditContext(request, {
      targetKind: "spambank_leads",
      targetId: "list",
      region: attr.jurisdiction,
    });
    try {
      return await listLeads(this.db.pool, attr.jurisdiction, query);
    } catch (error) {
      throw badCursor(error);
    }
  }

  // Declared before `:orgDomain` on purpose: a static path wins in the router either way, this keeps it obvious.
  @StaffAction("spambank.leads.export")
  @Authorize({ kind: "spambank_lead", action: "view", idFrom: () => "self" })
  @NotValueMoving("A read.")
  @Get("export.csv")
  async exportCsv(
    @Query() query: LeadQueryDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const { attr } = await this.principals.resolve(request);
    const region = attr.jurisdiction;
    setStaffAuditContext(request, { targetKind: "spambank_leads", targetId: "export", region });
    const leads = await exportLeads(this.db.pool, region, { status: query.status, q: query.q });
    setStaffAuditContext(request, { detail: { rows: leads.length } });
    const day = new Date().toISOString().slice(0, 10);
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="spambank-leads-${region}-${day}.csv"`,
    );
    reply.header("cache-control", "no-store");
    return leadsToCsv(leads);
  }

  @StaffAction("spambank.leads.update")
  @Authorize({ kind: "spambank_lead", action: "update", idFrom: () => "self" })
  @NotValueMoving(
    "Sets a lead's status and note to the values sent; a repeat changes nothing more.",
  )
  @Patch(":orgDomain")
  async update(
    @Param("orgDomain") orgDomain: string,
    @Body() body: LeadUpdateDto,
    @Req() request: FastifyRequest,
  ): Promise<SpambankLead> {
    const { attr } = await this.principals.resolve(request);
    const domain = orgDomain.toLowerCase();
    setStaffAuditContext(request, {
      targetKind: "spambank_lead",
      targetId: domain,
      region: attr.jurisdiction,
      // The note's text stays out of the audit row: it is free text about a third party.
      detail: {
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.note === undefined ? {} : { note: body.note === null ? "cleared" : "set" }),
      },
    });
    const lead = await updateLead(this.db.pool, attr.jurisdiction, domain, body);
    if (lead === null) {
      throw new NotFoundException({ code: "not_found", message: "no such lead in your region" });
    }
    return lead;
  }
}

function badCursor(error: unknown): unknown {
  return error instanceof InvalidCursorError
    ? new BadRequestException({ code: "invalid_cursor", message: error.message })
    : error;
}
