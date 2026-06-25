async function main() {
  const studyId = "a85cb5ac-278e6746-89a125e7-dbd3e5ff-d049763a";
  try {
    const res = await fetch(`http://192.168.1.137:8042/studies/${studyId}`, {
      headers: {
        "Authorization": "Basic " + Buffer.from("admin:").toString("base64")
      }
    });
    if (res.ok) {
      const study = await res.json();
      console.log("Study Details:", JSON.stringify(study, null, 2));
      
      // Let's fetch details of each series in this study
      for (const seriesId of study.Series) {
        console.log(`\n--- Fetching Series ${seriesId} ---`);
        const seriesRes = await fetch(`http://192.168.1.137:8042/series/${seriesId}`, {
          headers: {
            "Authorization": "Basic " + Buffer.from("admin:").toString("base64")
          }
        });
        if (seriesRes.ok) {
          const series = await seriesRes.json();
          console.log("Series Description:", series.MainDicomTags?.SeriesDescription);
          console.log("Modality:", series.MainDicomTags?.Modality);
          console.log("Number of Instances:", series.Instances?.length);
          
          // Let's get the first instance of this series to check SOPClassUID, Manufacturer, and other tags
          if (series.Instances?.length > 0) {
            const instId = series.Instances[0];
            const instRes = await fetch(`http://192.168.1.137:8042/instances/${instId}/tags`, {
              headers: {
                "Authorization": "Basic " + Buffer.from("admin:").toString("base64")
              }
            });
            if (instRes.ok) {
              const tags = await instRes.json();
              console.log("SOPClassUID:", tags["0008,0016"]?.Value);
              console.log("Manufacturer:", tags["0008,0070"]?.Value);
              console.log("Modality (tag):", tags["0008,0060"]?.Value);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
