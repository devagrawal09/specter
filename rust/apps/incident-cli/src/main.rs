mod features;

use clap::{Parser, Subcommand};
use specter::{CommandOptions, Result};

use features::incidents::{
    GetIncident, IncidentView, OpenIncident, create_app, get_incident_ref, open_incident_ref,
};

#[derive(Parser)]
#[command(about = "Incident response built on the experimental Specter Rust 0.3 runtime")]
struct Cli {
    #[command(subcommand)]
    action: Option<Action>,
}

#[derive(Subcommand)]
enum Action {
    Demo,
    Verify,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let app = create_app().await?;

    match cli.action.unwrap_or(Action::Demo) {
        Action::Demo => {
            let execution = app
                .execute(
                    open_incident_ref(),
                    OpenIncident {
                        incident_id: "incident-1".into(),
                        summary: "Checkout unavailable".into(),
                        opened_at: "2026-07-16T12:00:00Z".into(),
                    },
                    CommandOptions::default(),
                )
                .await?;
            println!(
                "Committed {} event at version {}; reaction work is separate.",
                execution.events.len(),
                execution.version
            );

            execution.reactions.wait().await?;
            let incident: IncidentView = app
                .read(
                    get_incident_ref(),
                    GetIncident {
                        incident_id: "incident-1".into(),
                    },
                )
                .await?;
            println!(
                "After reactions:\n{}",
                serde_json::to_string_pretty(&incident)?
            );
            Ok(())
        }
        Action::Verify => {
            app.assert_scenarios().await?;
            println!("All Incident Slice Scenarios passed.");
            Ok(())
        }
    }
}
