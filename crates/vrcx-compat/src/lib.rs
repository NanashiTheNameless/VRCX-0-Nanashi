//! Compatibility with tools and worlds built for VRCX.
//!
//! - `ipc`: VRCX's local pipe. Other programs send custom user tags, Game Log
//!   entries and launch commands; VRCX-0-Nanashi announces itself and the user
//!   dialogs it opens, using VRCX's packet format.
//! - `world_data`: VRCX's Persistent World Info. Worlds store values with
//!   `[VRCX-World]` lines in VRChat's log and read them back over HTTP from
//!   `http://127.0.0.1:22500/vrcx/data/...`, in VRCX's request and response
//!   format.
//!
//! Both are off until the user turns them on.

pub mod ipc;
pub mod world_data;

pub use ipc::{
    default_ipc_pipe_name, default_ipc_socket_path, IpcHandler, IpcInboundMessage, IpcServer,
    IpcSettings, IpcStatus,
};
pub use world_data::{
    WorldDataEntry, WorldDataImportReport, WorldDataService, WorldDataSettings, WorldDataStatus,
    WorldDataWorld, DEFAULT_WORLD_DATA_PORT, WORLD_DATA_DB_FILE,
};
