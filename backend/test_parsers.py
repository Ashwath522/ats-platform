import os
import sys

# Set up path so we can import from app
sys.path.insert(0, os.path.abspath("."))

from app.services.report_parsers.router import route_file

def test_parsers():
    test_files = [
        "test_file.txt",
        "test_file.py",
    ]
    
    # Create dummy files
    with open("test_file.txt", "w") as f:
        f.write("Hello, this is a plain text file.")
    with open("test_file.py", "w") as f:
        f.write("def foo():\n    return 'bar'")
        
    for file in test_files:
        print(f"Testing {file}...")
        try:
            text, method = route_file(file)
            print(f"[{method}]: {text[:100]}...")
        except Exception as e:
            print(f"Error testing {file}: {e}")
            
    # Cleanup
    for file in test_files:
        if os.path.exists(file):
            os.remove(file)

if __name__ == "__main__":
    test_parsers()
