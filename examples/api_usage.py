"""Example of using the BioRAG API via HTTP requests."""

import requests
import json


def test_api():
    """Test the BioRAG API endpoints."""
    
    base_url = "http://localhost:8000"
    
    print("🔬 BioRAG API Usage Example")
    print("=" * 50)
    
    # Test health endpoint
    print("\n1. Health Check")
    print("-" * 20)
    try:
        response = requests.get(f"{base_url}/health")
        if response.status_code == 200:
            health = response.json()
            print(f"Status: {health['status']}")
            print(f"Version: {health['version']}")
        else:
            print(f"Health check failed: {response.status_code}")
            return
    except requests.exceptions.ConnectionError:
        print("Cannot connect to BioRAG API. Make sure the server is running.")
        print("Start the server with: python -m biorag serve")
        return
    
    # Test basic query
    print("\n2. Basic Query")
    print("-" * 20)
    query_data = {
        "question": "What are the main functions of mitochondria?",
        "max_documents": 5,
        "response_type": "answer"
    }
    
    response = requests.post(f"{base_url}/query", json=query_data)
    if response.status_code == 200:
        result = response.json()
        print(f"Answer: {result['answer'][:150]}...")
        print(f"Documents found: {result['retrieval']['documents_found']}")
        print(f"Search strategy: {result['retrieval']['search_strategy']}")
    else:
        print(f"Query failed: {response.status_code}")
        print(response.text)
    
    # Test gene search
    print("\n3. Gene Search")
    print("-" * 20)
    gene_data = {
        "gene": "APOE",
        "organism": "Homo sapiens",
        "response_type": "answer"
    }
    
    response = requests.post(f"{base_url}/search/gene", json=gene_data)
    if response.status_code == 200:
        result = response.json()
        print(f"APOE info: {result['answer'][:150]}...")
    else:
        print(f"Gene search failed: {response.status_code}")
    
    # Test disease search
    print("\n4. Disease Search")
    print("-" * 20)
    disease_data = {
        "disease": "Alzheimer's disease",
        "response_type": "summary"
    }
    
    response = requests.post(f"{base_url}/search/disease", json=disease_data)
    if response.status_code == 200:
        result = response.json()
        print(f"Alzheimer's info: {result['answer'][:150]}...")
    else:
        print(f"Disease search failed: {response.status_code}")
    
    # Test pathway exploration
    print("\n5. Pathway Exploration")
    print("-" * 20)
    pathway_data = {
        "pathway": "insulin signaling",
        "focus": "genes"
    }
    
    response = requests.post(f"{base_url}/explore/pathway", json=pathway_data)
    if response.status_code == 200:
        result = response.json()
        print(f"Insulin pathway genes: {result['answer'][:150]}...")
    else:
        print(f"Pathway exploration failed: {response.status_code}")
    
    # Test comparison
    print("\n6. Entity Comparison")
    print("-" * 20)
    comparison_data = {
        "entities": ["insulin", "glucagon"],
        "entity_type": "protein",
        "comparison_aspect": "function"
    }
    
    response = requests.post(f"{base_url}/compare", json=comparison_data)
    if response.status_code == 200:
        result = response.json()
        print(f"Insulin vs Glucagon: {result['answer'][:150]}...")
    else:
        print(f"Comparison failed: {response.status_code}")
    
    # Test document search
    print("\n7. Document Search")
    print("-" * 20)
    doc_search_data = {
        "query": "immune system response",
        "limit": 3
    }
    
    response = requests.post(f"{base_url}/documents/search", json=doc_search_data)
    if response.status_code == 200:
        result = response.json()
        print(f"Found {result['document_count']} documents:")
        for i, doc in enumerate(result['documents'][:3], 1):
            print(f"  {i}. {doc['title'][:50]}... ({doc['source']})")
    else:
        print(f"Document search failed: {response.status_code}")
    
    # Test system statistics
    print("\n8. System Statistics")
    print("-" * 20)
    response = requests.get(f"{base_url}/stats")
    if response.status_code == 200:
        stats = response.json()
        print(f"Documents: {stats['document_count']}")
        print(f"Collection: {stats['collection_name']}")
        print(f"Embedding model: {stats['embedding_model']}")
    else:
        print(f"Stats request failed: {response.status_code}")


if __name__ == "__main__":
    test_api() 