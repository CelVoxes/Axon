# Workspace-Based Download System

## 🎯 **Problem Solved**

Previously, the bioRAG system downloaded biological datasets to a fixed location on your computer. Now it downloads everything directly to **your chosen workspace folder**, keeping all analysis files organized and accessible.

## 📁 **How It Works**

### 1. **Workspace Selection**

When you open the Electron app, first select your workspace directory:

- Click "Open Workspace"
- Choose any folder where you want your analysis files
- This becomes the root for all downloads and analysis

### 2. **Download Structure**

All datasets download directly to the analysis project's data folder:

```
Your_Workspace_Folder/
├── cancer_analysis_20250125_143022/          ← Analysis project folder
│   ├── data/                                 ← Datasets download HERE!
│   │   ├── biorag_downloads/
│   │   │   ├── geo_data/
│   │   │   │   ├── processed_data/
│   │   │   │   │   ├── GSE12345/
│   │   │   │   │   │   ├── GSE12345_expression_matrix.csv
│   │   │   │   │   │   ├── GSE12345_sample_info.csv
│   │   │   │   │   │   └── GSE12345_analysis_info.json
│   │   │   │   │   └── GSE67890/
│   │   │   │   │       ├── GSE67890_expression_matrix.csv
│   │   │   │   │       └── ...
│   │   │   │   └── raw_data/
│   │   │   ├── datasets/
│   │   │   │   └── datasets.db
│   │   │   └── metadata/
│   ├── results/
│   │   ├── differential_expression.csv
│   │   └── pathway_analysis.csv
│   └── figures/
│       ├── heatmap.png
│       ├── volcano_plot.png
│       └── clustering.png
```

### 3. **Analysis Integration**

- **Data Download:** Datasets are downloaded directly through Jupyter notebooks
- **Size Checking:** System checks dataset sizes before downloading
- **Progress Monitoring:** Real-time download progress in Jupyter output
- **Memory Management:** Shows memory usage for loaded datasets
- **Results Saving:** All outputs (figures, CSV files) save to analysis project folders

## ✅ **Benefits**

### **Organization**

- All project files in one place
- Easy to share entire analysis folder
- No scattered files across your system

### **Accessibility**

- Open files directly in Excel, R, Python
- View figures in any image viewer
- Copy/move analysis folders as needed

### **Collaboration**

- Share workspace folder with colleagues
- Everything needed for analysis is included
- Reproducible analysis environment

### **Version Control**

- Git track entire analysis project
- Include data and results in repositories
- Easy backup and archiving

## 🚀 **Example Workflow**

1. **Select Workspace:** Choose `/Users/yourname/BioAnalysis/`

2. **Ask Question:** "Find breast cancer datasets and analyze differential expression"

3. **Dataset Selection:** Choose 2 datasets from the modal

4. **Jupyter-Based Download:**

   - Creates analysis project folder: `/Users/yourname/BioAnalysis/cancer_analysis_20250125/`
   - Jupyter notebook checks dataset sizes and estimates download time
   - Downloads datasets directly through the notebook with progress monitoring
   - Shows memory usage and data loading statistics

5. **Analysis Execution:**

   - Datasets are loaded and prepared in the Jupyter environment
   - Analysis code runs on the downloaded data
   - Saves all results to analysis project subfolders (results/, figures/)

6. **Access Results:**
   - Open `/Users/yourname/BioAnalysis/cancer_analysis_20250125/figures/`
   - View heatmaps, volcano plots, etc.
   - Import CSV files into Excel or R

## 💡 **Pro Tips**

- **Use descriptive workspace names:** `AML_Study_2025`, `Drug_Response_Analysis`
- **One workspace per project:** Keeps analyses organized
- **Backup important workspaces:** Contains all your research data
- **Share workspace folders:** Easy collaboration with team members

The workspace system ensures your biological data analysis is **organized, accessible, and completely under your control**! 🧬📊
