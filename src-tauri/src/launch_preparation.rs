use std::future::Future;

// Created only after preparation finishes; never serialized or retained between launches.
pub(crate) struct PreparedAssets {
    pub asset_index_id: String,
}

pub(crate) async fn resolve<F, Fut>(prepared: Option<PreparedAssets>, check: F) -> Result<String, String>
where F: FnOnce() -> Fut, Fut: Future<Output = Result<String, String>> {
    match prepared {
        Some(assets) => Ok(assets.asset_index_id),
        None => check().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn prepared_launch_consumes_its_index_without_rechecking() {
        let index = resolve(Some(PreparedAssets { asset_index_id: "26".into() }), || async { panic!("duplicate verification") }).await.unwrap();
        assert_eq!(index, "26");
    }
    #[tokio::test]
    async fn direct_launch_runs_checks_and_preserves_failures() {
        assert_eq!(resolve(None, || async { Ok("checked".into()) }).await.unwrap(), "checked");
        assert_eq!(resolve(None, || async { Err("repair failed".into()) }).await.unwrap_err(), "repair failed");
    }
}
