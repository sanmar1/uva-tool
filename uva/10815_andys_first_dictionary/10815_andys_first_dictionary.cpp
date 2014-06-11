#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <vector>
#include <set>
#include <map>
#include <string>
#include <cctype>
#include <iostream>

using namespace std;	

int main() {
	string word;
	set<string> dict;
		
	while(cin >> word){
		string newword;
		for(int i = 0; i < word.size(); ++i){
				char c = word[i];
				if(isalpha(c)){
					c = tolower(c);
					newword+=c;			
				}
				else{
				  if(newword.size()>0){
					dict.insert(newword);
					newword.clear();
					}
				}
		}
		if(newword.size()>0)
		dict.insert(newword);
	}
	set<string>::iterator it;
	for(it = dict.begin(); it != dict.end(); ++it){
		printf("%s\n", (*it).c_str());
	}
  return 0;
}
