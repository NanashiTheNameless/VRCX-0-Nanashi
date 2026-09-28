use std::future::{self, Future};

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{
    Implementation, ListResourcesResult, PaginatedRequestParams, ReadResourceRequestParams,
    ReadResourceResponse, ReadResourceResult, Resource, ResourceContents, ServerCapabilities,
    ServerConfig,
};
use rmcp::service::{MaybeSendFuture, RequestContext, RoleServer};
use rmcp::{tool_handler, ErrorData as RmcpError, ServerHandler};

use crate::runtime::McpRuntime;

const DATA_CAVEATS_URI: &str = "vrcx://data-caveats";

const SERVER_INSTRUCTIONS: &str = "\
VRCX-0-Nanashi (a fork of VRCX-0 - always say \"VRCX-0-Nanashi\", never \"VRCX\" or \"VRCX-0\", in user-facing replies) exposes the signed-in user's VRChat social facts from local, observer-centered history and the live session. \
Tools return aggregated facts centered on the signed-in user (\"me\"); you interpret them. Never use emoji in replies.

Ground rules:
- Missing data means \"not observed\". It never means \"did not happen\".
- Facts about me hold even in private instances. What OTHERS did in private instances the user did not attend is invisible - say the picture is partial.
- Reflect each result's `caveats`; treat figures as approximate.
- Ranked tools pre-sort and limit rows: read the top rows; do not loop to enumerate everyone. Pass a small `limit` only to widen or narrow the ranking.
- User-targeting tools accept a usr_ id or a display name. Check `resolvedUser` is the intended person; on `needsDisambiguation`, ask the user instead of guessing.
- Results with a `summary` field are ready-to-read fact bundles; narrate from the summary, then add only the caveats and details the question needs.
- `timeWindow` accepts {from, to} RFC3339, a four-digit calendar year such as 2026, or a relative string (\"this week\", \"7d\"); omit it only when the chosen tool permits all history.
- Writes (favorite_local, favorite_vrchat, set_friend_note) default to dry_run=true and never message other users; confirm before a real write.
- Reminders (create_reminder, delete_reminder) are local writes with no dry_run; repeat the reminder back and get a yes before creating it.

Tool tiers - pick the right altitude:
- [L1·query/resolve] leaf lookups: one source, a list of rows. Building blocks.
- [L2·analyze] server-side aggregates: ranked/bucketed facts with a summary. Prefer these for who/when/most questions; they already did the counting, so read the top rows and don't loop.
- [L2·advanced] large/raw output for custom analysis; a higher-tier tool usually answers the common question.
- [L3·bundle] one call composing several L2 analyses into a ready narrative; do NOT re-call the parts it already includes.
- [write]/[action] side effects; dry_run defaults true, confirm first.
Pick the highest tier that answers the question; drill to L1 only for detail the aggregate did not include.

Map fuzzy requests to tools, then read each tool's own description for details (compose freely):
- Turn a name into candidate userIds when you need manual disambiguation -> find_user
- Remind me / tell me when someone comes online, goes offline, moves, joins me, or at a time -> create_reminder (manage with list_reminders, delete_reminder)
- Closest to / who I play with most -> get_copresence_summary
- Drifting from / losing touch with -> get_fading_friends
- My playtime by month/year/week, trends, or when I log on -> get_activity_timeline
- My longest break, play streak, or active days -> get_activity_streaks
- When to log on to catch people -> get_best_time_to_play (one friend: get_friend_activity_pattern)
- Who was that person, by name fragment, time, world, or who they were with -> recall_encounter
- Recap a week or month -> summarize_social_period
- Who someone else hangs out with -> get_companions_of
- A single friend, or who is online now -> get_friend_profile, get_online_friends
- Exact observed friend Feed history -> search_friend_feed
- Which of my friends know each other / friend groups -> get_friend_circles
- History, mutuals, invites, status changes -> get_friend_log, get_social_graph (refresh_mutual_graph if stale), get_invite_history, get_friend_changes

For vague asks, start with summarize_social_period or get_online_friends, then drill in and cross-reference.";

pub(crate) struct VrcxMcpServer {
    pub(crate) runtime: McpRuntime,
    pub(crate) tool_router: ToolRouter<Self>,
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for VrcxMcpServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("vrcx-0", env!("CARGO_PKG_VERSION")))
        .with_instructions(SERVER_INSTRUCTIONS)
    }

    fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListResourcesResult, RmcpError>> + MaybeSendFuture + '_ {
        let resource = Resource::new(DATA_CAVEATS_URI, "data_caveats")
            .with_title("VRCX-0-Nanashi Data Caveats")
            .with_description("Observer-centered data caveats for all VRCX-0-Nanashi MCP tools.")
            .with_mime_type("text/plain");
        future::ready(Ok(ListResourcesResult::with_all_items(vec![resource])))
    }

    fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ReadResourceResponse, RmcpError>> + MaybeSendFuture + '_ {
        if request.uri != DATA_CAVEATS_URI {
            return future::ready(Err(RmcpError::invalid_params(
                "Unknown VRCX-0-Nanashi MCP resource",
                None,
            )));
        }
        future::ready(Ok(ReadResourceResult::new(vec![ResourceContents::text(
            data_caveats_resource(),
            DATA_CAVEATS_URI,
        )
        .with_mime_type("text/plain")])
        .into()))
    }
}

fn data_caveats_resource() -> String {
    [
        "VRCX-0-Nanashi data is observer-centered and not a global VRChat record.",
        "Missing rows mean this VRCX-0-Nanashi profile did not observe the event, not that the event did not happen.",
        "Co-presence minutes are useful for relative sorting; join/leave pairing can undercount absolute duration.",
        "Private instances that the owner cannot see may only appear as private and cannot be separated by instance.",
    ]
    .join("\n")
}

#[cfg(test)]
mod instructions_tests {
    use super::SERVER_INSTRUCTIONS;

    #[test]
    fn server_instructions_keep_core_boundaries_and_relative_time_windows() {
        for phrase in [
            "VRCX-0-Nanashi",
            "not observed",
            "private instances",
            "caveats",
            "needsDisambiguation",
            "resolvedUser",
            "dry_run",
            "relative string",
            "calendar year",
            "`timeWindow`",
            "search_friend_feed",
            "Exact observed friend Feed history",
        ] {
            assert!(
                SERVER_INSTRUCTIONS.contains(phrase),
                "missing phrase: {phrase}"
            );
        }
        assert!(!SERVER_INSTRUCTIONS.contains("Time windows are RFC3339"));
        assert!(SERVER_INSTRUCTIONS.contains("always say \"VRCX-0-Nanashi\""));
        assert!(SERVER_INSTRUCTIONS.contains("Never use emoji"));
    }
}
