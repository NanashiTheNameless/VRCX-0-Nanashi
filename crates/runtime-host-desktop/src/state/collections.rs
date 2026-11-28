use vrcx_0_application::collections::{
    SharedCollectionImportStartInput, SharedCollectionImportStatus,
};
use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub async fn preview_shared_collection(
        &self,
        id: &str,
    ) -> Result<vrcx_0_application::collections::ImportPreview> {
        let adapter =
            vrcx_0_outbound_adapters::LocalWorldCollectionAdapter::new(self.config_string(
                "remoteSyncApiOrigin",
                "https://vrcx-api.namelessnanashi.dev",
            ));
        Ok(vrcx_0_application::collections::preview_shared_collection(&adapter, id).await?)
    }

    pub fn start_shared_collection_import(
        &self,
        input: SharedCollectionImportStartInput,
    ) -> Result<SharedCollectionImportStatus> {
        Ok(self.runtime.shared_collection_import().start(input)?)
    }

    pub fn shared_collection_import_status(&self) -> SharedCollectionImportStatus {
        self.runtime.shared_collection_import().status()
    }

    pub fn start_note_export(
        &self,
        input: vrcx_0_application::social::NoteExportStartInput,
    ) -> Result<vrcx_0_application::social::NoteExportStatus> {
        Ok(self.runtime.note_export().start(input)?)
    }

    pub fn note_export_status(&self) -> vrcx_0_application::social::NoteExportStatus {
        self.runtime.note_export().status()
    }

    pub fn cancel_note_export(&self) -> vrcx_0_application::social::NoteExportStatus {
        self.runtime.note_export().cancel()
    }
}
