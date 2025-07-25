"""Basic usage example for the BioRAG system."""

import asyncio
from biorag import BioRAGClient


async def main():
    """Demonstrate basic BioRAG functionality."""
    
    print("🧬 BioRAG System Example")
    print("=" * 50)
    
    # Initialize the client
    async with BioRAGClient() as client:
        
        # Example 1: Basic biological question
        print("\n1. Basic Biological Question")
        print("-" * 30)
        question = "What is the function of the TP53 gene?"
        print(f"Question: {question}")
        
        result = await client.query(question, max_documents=5)
        print(f"Answer: {result['answer'][:200]}...")
        print(f"Retrieved {result['retrieval']['documents_found']} documents")
        print(f"Context type: {result['retrieval']['context_type']}")
        
        # Example 2: Gene-specific search
        print("\n2. Gene-Specific Search")
        print("-" * 30)
        gene_result = await client.search_gene("BRCA1", organism="Homo sapiens")
        print(f"BRCA1 info: {gene_result['answer'][:200]}...")
        
        # Example 3: Disease search
        print("\n3. Disease Search")
        print("-" * 30)
        disease_result = await client.search_disease("breast cancer")
        print(f"Breast cancer info: {disease_result['answer'][:200]}...")
        
        # Example 4: Compare genes
        print("\n4. Gene Comparison")
        print("-" * 30)
        comparison = await client.compare_genes(["TP53", "BRCA1"], aspect="function")
        print(f"Gene comparison: {comparison['answer'][:200]}...")
        
        # Example 5: Explore pathway
        print("\n5. Pathway Exploration")
        print("-" * 30)
        pathway_result = await client.explore_pathway("p53 pathway")
        print(f"p53 pathway: {pathway_result['answer'][:200]}...")
        
        # Example 6: Research insights
        print("\n6. Research Insights")
        print("-" * 30)
        insights = await client.get_research_insights("cancer genomics")
        print(f"Research insights: {insights['answer'][:200]}...")
        
        # Example 7: Experimental design
        print("\n7. Experimental Design Suggestions")
        print("-" * 30)
        experiment = await client.design_experiment(
            "How to study gene expression changes in cancer cells?"
        )
        print(f"Experimental design: {experiment['answer'][:200]}...")
        
        # Example 8: Document search
        print("\n8. Document Search")
        print("-" * 30)
        docs = await client.search_documents("CRISPR gene editing", limit=3)
        print(f"Found {len(docs)} documents about CRISPR:")
        for i, doc in enumerate(docs[:3], 1):
            print(f"  {i}. {doc.get('title', 'Untitled')} ({doc.get('source', 'Unknown')})")
        
        # Example 9: System statistics
        print("\n9. System Statistics")
        print("-" * 30)
        stats = await client.get_stats()
        print(f"Documents in knowledge base: {stats.get('document_count', 0)}")
        print(f"Collection: {stats.get('name', 'Unknown')}")


if __name__ == "__main__":
    # Note: You need to set up your environment variables first:
    # OPENAI_API_KEY=your_openai_api_key
    # Optionally: NCBI_API_KEY=your_ncbi_api_key
    
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"Error: {e}")
        print("\nMake sure you have:")
        print("1. Set the OPENAI_API_KEY environment variable")
        print("2. Installed all dependencies: pip install -r requirements.txt")
        print("3. Have an internet connection for accessing biological databases") 